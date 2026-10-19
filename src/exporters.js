/**
 * Game-format exporters: design JSON -> FTB Quests / Patchouli / KubeJS.
 *
 * FTB Quests implementation follows docs/research/ftbquests-format.md, verified
 * against FTB Quests 2101.1.36 sources and the ATM-10 modpack data:
 *  - config/ftbquests/quests/{data.snbt, chapter_groups.snbt, chapters/*.snbt, lang/<locale>.snbt}
 *  - ids are 16 uppercase hex chars from a signed-long positive range (first char 0-7)
 *  - all text lives in lang/<locale>.snbt, keys `<type>.<ID>.<key>`
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { getEntry, listEntries } from './design.js'

// ---------------------------------------------------------------------------
// SNBT helpers
// ---------------------------------------------------------------------------

const LONG = (value) => ({ __snbt: `${value}L` })
const DOUBLE = (value) => ({ __snbt: `${Number.isInteger(value) ? value.toFixed(1) : value}d` })

function snbtQuote(text) {
  const escaped = String(text)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

function snbtKey(key) {
  return /^[A-Za-z0-9._+\-]+$/.test(key) ? key : snbtQuote(key)
}

/** Serialize a plain JS structure to SNBT text (tab indent, sorted keys). */
export function toSnbt(value, indent = '') {
  if (value === undefined || value === null) return 'null'
  if (typeof value === 'string') return snbtQuote(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : DOUBLE(value).__snbt
  if (Array.isArray(value)) {
    if (!value.length) return '[ ]'
    const inline = value.every((item) => item === null || typeof item !== 'object' || item.__snbt)
    if (inline) return `[${value.map((item) => toSnbt(item, indent)).join(', ')}]`
    const inner = indent + '\t'
    return `[\n${value.map((item) => `${inner}${toSnbt(item, inner)}`).join('\n')}\n${indent}]`
  }
  if (typeof value === 'object') {
    if (typeof value.__snbt === 'string') return value.__snbt
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
    if (!keys.length) return '{ }'
    const inner = indent + '\t'
    return `{\n${keys.map((key) => `${inner}${snbtKey(key)}: ${toSnbt(value[key], inner)}`).join('\n')}\n${indent}}`
  }
  return snbtQuote(value)
}

// ---------------------------------------------------------------------------
// Stable ids
// ---------------------------------------------------------------------------

function makeIdRegistry() {
  const used = new Set()
  return {
    next(key) {
      let salt = 0
      for (;;) {
        const hash = createHash('sha256').update(salt ? `${key}#${salt}` : key).digest()
        let value = BigInt(`0x${hash.subarray(0, 8).toString('hex')}`)
        value &= 0x7fffffffffffffffn
        if (value !== 0n && value !== 1n) {
          const hex = value.toString(16).toUpperCase().padStart(16, '0')
          if (!used.has(hex)) {
            used.add(hex)
            return hex
          }
        }
        salt += 1
      }
    },
    add(hex) {
      used.add(String(hex).toUpperCase())
    },
  }
}

function sanitizeFilename(id, fallback) {
  const base = String(id)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
  return base || fallback
}

// ---------------------------------------------------------------------------
// FTB Quests
// ---------------------------------------------------------------------------

const QUEST_SHAPES = ['square', 'circle', 'diamond', 'gear', 'heart', 'hexagon', 'octagon', 'pentagon', 'rsquare', 'none']

function itemStack(spec, config) {
  if (!spec) return undefined
  const text = String(spec)
  const id = text.includes(':') ? text : `${config.namespace}:${text}`
  return { id }
}

function questDescriptionLines(description) {
  if (!description) return undefined
  if (Array.isArray(description)) return description.map(String)
  return String(description).split('\n')
}

function taskToSnbt(task, ids, config, warnings, chapterId, questId, index) {
  if (!task || typeof task !== 'object') return undefined
  const type = String(task.type ?? '')
  const id = ids.next(`task:${chapterId}:${questId}:${index}`)
  const out = { id, type }
  switch (type) {
    case 'item': {
      const item = itemStack(task.item, config)
      if (!item) {
        warnings.push(`任务 ${chapterId}/${questId} 的 item 任务缺少 item 字段，已跳过`)
        return undefined
      }
      out.item = { ...item, ...(Number(task.count) > 1 ? { count: Number(task.count) } : {}) }
      if (Number(task.count) > 1) out.count = LONG(Number(task.count))
      if (task.consumeItems === false) out.consume_items = false
      break
    }
    case 'kill': {
      if (!task.entity) {
        warnings.push(`任务 ${chapterId}/${questId} 的 kill 任务缺少 entity，已跳过`)
        return undefined
      }
      out.entity = String(task.entity).includes(':') ? String(task.entity) : `minecraft:${task.entity}`
      out.value = LONG(Number(task.count ?? task.value ?? 1))
      break
    }
    case 'checkmark':
      break
    case 'advancement':
      out.advancement = String(task.advancement ?? '')
      out.criterion = String(task.criterion ?? '')
      break
    case 'stat':
      out.stat = String(task.stat ?? '')
      out.value = Number(task.value ?? 1)
      break
    case 'observation':
      out.to_observe = String(task.toObserve ?? task.to_observe ?? '')
      out.observation_type = String(task.observationType ?? task.observation_type ?? 'block')
      out.timer = LONG(Number(task.timer ?? 0))
      out.observe_type = Number(task.observeType ?? task.observe_type ?? 0)
      break
    case 'dimension':
    case 'biome':
    case 'structure':
      out[type] = String(task[type] ?? '')
      break
    case 'location':
      out.dimension = String(task.dimension ?? 'minecraft:overworld')
      if (Array.isArray(task.position)) out.position = task.position.slice(0, 3).map(Number)
      if (Array.isArray(task.size)) out.size = task.size.slice(0, 3).map(Number)
      break
    case 'xp':
      out.value = LONG(Number(task.value ?? task.amount ?? 1))
      out.points = Boolean(task.points)
      break
    default:
      warnings.push(`任务 ${chapterId}/${questId} 的任务类型 "${type}" 暂不支持导出，已跳过`)
      return undefined
  }
  return out
}

function rewardToSnbt(reward, ids, config, warnings, chapterId, questId, index) {
  if (!reward || typeof reward !== 'object') return undefined
  const type = String(reward.type ?? '')
  const id = ids.next(`reward:${chapterId}:${questId}:${index}`)
  const out = { id, type }
  switch (type) {
    case 'item': {
      const item = itemStack(reward.item, config)
      if (!item) {
        warnings.push(`任务 ${chapterId}/${questId} 的 item 奖励缺少 item 字段，已跳过`)
        return undefined
      }
      out.item = { ...item, ...(Number(reward.count) > 1 ? { count: Number(reward.count) } : {}) }
      if (Number(reward.count) > 1) out.count = Number(reward.count)
      break
    }
    case 'xp':
      out.xp = Number(reward.xp ?? reward.amount ?? 0)
      break
    case 'xp_levels':
      out.xp_levels = Number(reward.xpLevels ?? reward.amount ?? 0)
      break
    case 'command':
      out.command = String(reward.command ?? '')
      if (Number(reward.permissionLevel) > 0) out.permission_level = Number(reward.permissionLevel)
      break
    case 'toast':
      out.description = String(reward.description ?? reward.text ?? '')
      break
    case 'gamestage':
      out.stage = String(reward.stage ?? '')
      if (reward.remove) out.remove = true
      break
    case 'currency':
      out.amount = Number(reward.amount ?? 0)
      break
    case 'loot':
    case 'random':
    case 'choice':
      warnings.push(`任务 ${chapterId}/${questId} 的 ${type} 奖励需要奖励表，本版本暂不导出（后续支持 reward_tables）`)
      return undefined
    default:
      warnings.push(`任务 ${chapterId}/${questId} 的奖励类型 "${type}" 暂不支持导出，已跳过`)
      return undefined
  }
  return out
}

/**
 * Export design quest chapters to FTB Quests files.
 * Output layout (under outDir): quests/{data.snbt, chapter_groups.snbt, chapters/*.snbt, lang/<locale>.snbt}
 */
export async function exportFtbQuests({ config, project, designRoot, outDir, namespace, language = 'zh_cn' }) {
  const warnings = []
  const ids = makeIdRegistry()
  const lang = {}
  const files = []

  const listed = await listEntries(designRoot, 'quest_chapter')
  const chapters = []
  for (const entry of listed.entries) {
    const { data } = await getEntry(designRoot, 'quest_chapter', entry.id)
    chapters.push(data)
  }
  chapters.sort((a, b) => Number(a.order ?? 9999) - Number(b.order ?? 9999) || String(a.id).localeCompare(String(b.id)))

  // Pass 1: allocate ids for chapters, quests and groups.
  const groupIds = new Map()
  for (const chapter of chapters) {
    const group = String(chapter.group ?? '').trim()
    if (group && !groupIds.has(group)) groupIds.set(group, ids.next(`quest:group:${group}`))
    chapter.__id = ids.next(`quest:chapter:${chapter.id}`)
    chapter.__questIds = new Map()
    for (const quest of chapter.quests ?? []) {
      if (!quest?.id) {
        warnings.push(`任务章节 ${chapter.id} 里有任务缺少 id，已跳过`)
        continue
      }
      chapter.__questIds.set(quest.id, ids.next(`quest:${chapter.id}:${quest.id}`))
    }
  }
  // Cross-chapter dependency lookup.
  const questIdLookup = new Map()
  for (const chapter of chapters) {
    for (const [designId, hex] of chapter.__questIds) questIdLookup.set(`${chapter.id}:${designId}`, hex)
  }

  const chapterFileNames = new Set()
  const chapterSnbtList = []
  let questCount = 0
  let taskCount = 0
  let rewardCount = 0

  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
    const chapter = chapters[chapterIndex]
    let filename = sanitizeFilename(chapter.filename ?? chapter.id, `chapter_${chapterIndex + 1}`)
    let suffix = 2
    while (chapterFileNames.has(filename)) filename = `${sanitizeFilename(chapter.id, 'chapter')}_${suffix++}`
    chapterFileNames.add(filename)

    const quests = []
    let questIndex = 0
    for (const quest of chapter.quests ?? []) {
      const hex = chapter.__questIds.get(quest?.id)
      if (!hex) continue
      const x = Number.isFinite(Number(quest.x)) ? Number(quest.x) : 2.0 * (questIndex % 8)
      const y = Number.isFinite(Number(quest.y)) ? Number(quest.y) : 1.5 * Math.floor(questIndex / 8)
      questIndex += 1

      const out = { id: hex, x: DOUBLE(x), y: DOUBLE(y) }
      if (quest.shape && QUEST_SHAPES.includes(quest.shape)) out.shape = quest.shape
      if (Number.isFinite(Number(quest.size)) && Number(quest.size) !== 1) out.size = Number(quest.size)
      const icon = itemStack(quest.icon, { ...config, namespace })
      if (icon) out.icon = icon

      const dependencies = []
      for (const dependency of quest.dependencies ?? []) {
        const text = String(dependency)
        const resolved = text.includes(':')
          ? questIdLookup.get(text)
          : chapter.__questIds.get(text)
        if (resolved) dependencies.push(resolved)
        else warnings.push(`任务 ${chapter.id}/${quest.id} 依赖的 "${text}" 找不到，已忽略`)
      }
      if (dependencies.length) out.dependencies = dependencies
      if (quest.dependencyRequirement) out.dependency_requirement = String(quest.dependencyRequirement)
      if (quest.optional) out.optional = true
      if (quest.canRepeat) out.can_repeat = true
      if (Number(quest.minWidth) > 0) out.min_width = Number(quest.minWidth)
      if (quest.hideDependencyLines) out.hide_dependency_lines = true

      const tasks = []
      ;(quest.tasks ?? []).forEach((task, taskIndex) => {
        const converted = taskToSnbt(task, ids, { ...config, namespace }, warnings, chapter.id, quest.id, taskIndex)
        if (converted) tasks.push(converted)
      })
      const rewards = []
      ;(quest.rewards ?? []).forEach((reward, rewardIndex) => {
        const converted = rewardToSnbt(reward, ids, { ...config, namespace }, warnings, chapter.id, quest.id, rewardIndex)
        if (converted) rewards.push(converted)
      })
      if (tasks.length) {
        out.tasks = tasks
        taskCount += tasks.length
      }
      if (rewards.length) {
        out.rewards = rewards
        rewardCount += rewards.length
      }
      quests.push(out)

      // Texts -> lang file
      if (quest.title) lang[`quest.${hex}.title`] = String(quest.title)
      if (quest.subtitle) lang[`quest.${hex}.quest_subtitle`] = String(quest.subtitle)
      const description = questDescriptionLines(quest.description)
      if (description?.length) lang[`quest.${hex}.quest_desc`] = description
      questCount += 1
    }

    const chapterSnbt = {
      filename,
      id: chapter.__id,
      order_index: chapterIndex,
      quests,
      quest_links: [],
      images: [],
    }
    const group = String(chapter.group ?? '').trim()
    if (group) chapterSnbt.group = groupIds.get(group)
    const icon = itemStack(chapter.icon ?? 'minecraft:written_book', { ...config, namespace })
    if (icon) chapterSnbt.icon = icon
    if (chapter.defaultQuestShape && QUEST_SHAPES.includes(chapter.defaultQuestShape)) chapterSnbt.default_quest_shape = chapter.defaultQuestShape
    if (chapter.hideDependencies) chapterSnbt.default_hide_dependency_lines = true
    chapterSnbtList.push({ filename, chapter: chapterSnbt })
    if (chapter.title) lang[`chapter.${chapter.__id}.title`] = String(chapter.title)
    if (chapter.subtitle) lang[`chapter.${chapter.__id}.chapter_subtitle`] = [String(chapter.subtitle)]
  }

  for (const [group, hex] of groupIds) {
    const source = chapters.find((chapter) => String(chapter.group ?? '').trim() === group)
    lang[`chapter_group.${hex}.title`] = String(source?.groupTitle ?? group)
  }
  const bookTitle = project?.name ?? '任务书'
  lang['file.0000000000000001.title'] = bookTitle

  const questsDir = join(outDir, 'quests')
  await mkdir(join(questsDir, 'chapters'), { recursive: true })
  await mkdir(join(questsDir, 'lang'), { recursive: true })

  const dataSnbt = { version: 13, default_quest_shape: 'circle', fallback_locale: language, progression_mode: 'flexible' }
  await writeFile(join(questsDir, 'data.snbt'), `${toSnbt(dataSnbt)}\n`, 'utf8')
  files.push('quests/data.snbt')

  await writeFile(join(questsDir, 'chapter_groups.snbt'), `${toSnbt({ chapter_groups: [...groupIds.values()].map((id) => ({ id })) })}\n`, 'utf8')
  files.push('quests/chapter_groups.snbt')

  for (const { filename, chapter } of chapterSnbtList) {
    await writeFile(join(questsDir, 'chapters', `${filename}.snbt`), `${toSnbt(chapter)}\n`, 'utf8')
    files.push(`quests/chapters/${filename}.snbt`)
  }
  await writeFile(join(questsDir, 'lang', `${language}.snbt`), `${toSnbt(lang)}\n`, 'utf8')
  files.push(`quests/lang/${language}.snbt`)

  if (!chapters.length) warnings.push('没有找到 quest_chapter 设计，导出了空任务书（data/chapter_groups/lang 已生成）')

  return {
    outDir,
    files,
    summary: `${chapters.length} 个任务章节 / ${questCount} 个任务 / ${taskCount} 个任务目标 / ${rewardCount} 个奖励`,
    warnings,
    stats: { chapters: chapters.length, quests: questCount, tasks: taskCount, rewards: rewardCount, groups: groupIds.size, texts: Object.keys(lang).length },
  }
}

// ---------------------------------------------------------------------------
// Shared helpers for content exporters
// ---------------------------------------------------------------------------

function safeNamespace(value, fallback) {
  const raw = String(value ?? '').toLowerCase().replace(/[^a-z0-9_.-]/g, '')
  return raw || String(fallback ?? 'ipthmc').toLowerCase().replace(/[^a-z0-9_.-]/g, '') || 'ipthmc'
}

function safePath(value, fallback) {
  const raw = String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9/._-]/g, '')
    .replace(/^[._/-]+|[._/-]+$/g, '')
  if (raw) return raw
  return `${fallback ?? 'entry'}_${createHash('sha1').update(String(value ?? '')).digest('hex').slice(0, 8)}`
}

/** Markdown-ish body -> Patchouli text formatting. */
function markdownToPatchouli(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => {
      let out = line
      out = out.replace(/^#{1,6}\s+/, '')
      out = out.replace(/\*\*([^*]+)\*\*/g, '$(bold)$1$()')
      out = out.replace(/`([^`]+)`/g, '$(#8899ff)$1$()')
      out = out.replace(/^>\s?/, '')
      if (/^[-*]\s+/.test(out)) out = `$(li)${out.replace(/^[-*]\s+/, '')}`
      return out
    })
    .join('$(br)')
    .replace(/\$\(br\)\$\(br\)/g, '$(br2)')
}

/** Split text into Patchouli-sized pages (~500 chars), keeping paragraph breaks. */
function paginate(text, maxChars = 500) {
  const paragraphs = String(text ?? '')
    .split('$(br2)')
    .map((part) => part.trim())
    .filter(Boolean)
  const pages = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 6 > maxChars) {
      pages.push(current)
      current = paragraph
    } else {
      current = current ? `${current}$(br2)${paragraph}` : paragraph
    }
  }
  if (current) pages.push(current)
  return pages
}

async function loadAll(designRoot, kind) {
  const listed = await listEntries(designRoot, kind)
  const items = []
  for (const entry of listed.entries) {
    const { data } = await getEntry(designRoot, kind, entry.id)
    items.push(data)
  }
  items.sort((a, b) => Number(a.order ?? 9999) - Number(b.order ?? 9999) || String(a.id).localeCompare(String(b.id)))
  return items
}

// ---------------------------------------------------------------------------
// Patchouli guide book
// ---------------------------------------------------------------------------

/**
 * Export characters / factions / locations / lore / story / items into an external
 * Patchouli book. External books are loaded from the instance root `patchouli_books/`
 * (mrpack: `overrides/patchouli_books/<book>/`), never from datapacks.
 * `en_us` is Patchouli's scan index, so the Chinese content is written there
 * (a single-language pack needs no `zh_cn` overlay).
 */
export async function exportPatchouli({ config, project, designRoot, outDir, namespace, language = 'zh_cn' }) {
  const warnings = []
  const files = []
  const bookNamespace = safeNamespace(namespace, config?.defaultNamespace)
  const bookId = `${bookNamespace}_guide`
  const characters = await loadAll(designRoot, 'character')
  const factions = await loadAll(designRoot, 'faction')
  const locations = await loadAll(designRoot, 'location')
  const lore = await loadAll(designRoot, 'lore')
  const stories = await loadAll(designRoot, 'story_chapter')
  const items = await loadAll(designRoot, 'item')
  const recipes = await loadAll(designRoot, 'recipe')

  // item design id -> exported KubeJS item id (same rule as exportKubeJs)
  const itemIds = new Map()
  for (const item of items) {
    const ns = safeNamespace(item.namespace, bookNamespace)
    const path = safePath(item.id, 'item')
    itemIds.set(item.id, `${ns}:${path}`)
    if (path !== String(item.id).toLowerCase()) warnings.push(`物品 ${item.id} 的 id 含非法字符，KubeJS 导出为 ${ns}:${path}`)
  }
  const recipeIds = new Map()
  for (const recipe of recipes) {
    const ns = safeNamespace(recipe.namespace, bookNamespace)
    recipeIds.set(recipe.id, `${ns}:${safePath(recipe.id, 'recipe')}`)
  }

  const categories = [
    { id: 'world', name: '世界设定', description: '世界的历史、魔法、种族与传说。', icon: 'minecraft:book', sortnum: 0 },
    { id: 'story', name: '剧情纪要', description: '主线与支线故事的章节记录。', icon: 'minecraft:writable_book', sortnum: 1 },
    { id: 'characters', name: '人物志', description: '登场人物的档案与关系。', icon: 'minecraft:name_tag', sortnum: 2 },
    { id: 'factions', name: '势力与种族', description: '各方势力、组织与种族。', icon: 'minecraft:shield', sortnum: 3 },
    { id: 'locations', name: '地点图鉴', description: '世界中的区域、城镇与遗迹。', icon: 'minecraft:map', sortnum: 4 },
    { id: 'items', name: '物品图鉴', description: '独特的物品、武器与装备。', icon: 'minecraft:item_frame', sortnum: 5 },
  ]
  const hasContent = { world: lore.length, story: stories.length, characters: characters.length, factions: factions.length, locations: locations.length, items: items.length }
  const enabledCategories = categories.filter((category) => hasContent[category.id] > 0)
  if (!enabledCategories.length) warnings.push('没有人物/势力/地点/世界观/剧情/物品内容，导出了空书')

  const bookRoot = join(outDir, bookId)
  const writeJson = async (relativePath, data) => {
    const target = join(bookRoot, relativePath)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    files.push(`${bookId}/${relativePath}`)
  }

  await writeJson('book.json', {
    name: `${project?.name ?? '冒险指南'} · 设定集`,
    landing_text: `欢迎翻阅《${project?.name ?? '永世幻想间'}》世界设定集。$(br2)这里收录了世界的历史与传说、登场人物、各方势力、地点图鉴与独特物品。`,
    creative_tab: 'minecraft:tools_and_utilities',
    use_resource_pack: false,
  })
  for (const category of enabledCategories) {
    await writeJson(`en_us/categories/${category.id}.json`, {
      name: category.name,
      description: category.description,
      icon: category.icon,
      sortnum: category.sortnum,
    })
  }

  const addEntry = async (category, entryId, entry) => {
    await writeJson(`en_us/entries/${category}/${entryId}.json`, entry)
  }

  for (const entry of lore) {
    const pages = paginate(markdownToPatchouli(entry.body))
    await addEntry('world', safePath(entry.id, 'lore'), {
      name: entry.title ?? entry.id,
      icon: 'minecraft:book',
      category: 'patchouli:world',
      sortnum: Number(entry.order ?? 0),
      pages: pages.length ? pages.map((text) => ({ type: 'patchouli:text', text })) : [{ type: 'patchouli:text', text: '（待补充）' }],
    })
  }
  for (const entry of stories) {
    const pages = paginate(markdownToPatchouli(entry.body))
    await addEntry('story', safePath(entry.id, 'story'), {
      name: entry.title ?? entry.id,
      icon: 'minecraft:writable_book',
      category: 'patchouli:story',
      sortnum: Number(entry.order ?? 0),
      pages: pages.length ? pages.map((text) => ({ type: 'patchouli:text', text })) : [{ type: 'patchouli:text', text: entry.summary ?? '（待补充）' }],
    })
  }
  for (const entry of characters) {
    const info = [
      entry.title ? `$(bold)称号$()：${entry.title}` : '',
      entry.faction ? `$(bold)势力$()：${entry.faction}` : '',
      entry.status ? `$(bold)状态$()：${entry.status}` : '',
      entry.appearance ? `$(bold)外貌$()：${entry.appearance}` : '',
      entry.personality ? `$(bold)性格$()：${entry.personality}` : '',
      entry.background ? `$(bold)背景$()：${entry.background}` : '',
    ].filter(Boolean).join('$(br)')
    const pages = []
    if (info) pages.push({ type: 'patchouli:text', text: info })
    for (const text of paginate(markdownToPatchouli(entry.body))) pages.push({ type: 'patchouli:text', text })
    if (!pages.length) pages.push({ type: 'patchouli:text', text: '（人物档案待补充）' })
    await addEntry('characters', safePath(entry.id, 'character'), {
      name: entry.name ?? entry.id,
      icon: 'minecraft:name_tag',
      category: 'patchouli:characters',
      sortnum: Number(entry.order ?? 0),
      pages,
    })
  }
  for (const entry of factions) {
    const info = [
      entry.type ? `$(bold)类型$()：${entry.type}` : '',
      entry.leader ? `$(bold)领袖$()：${entry.leader}` : '',
      entry.territory ? `$(bold)势力范围$()：${entry.territory}` : '',
      entry.description ? entry.description : '',
    ].filter(Boolean).join('$(br)')
    const pages = []
    if (info) pages.push({ type: 'patchouli:text', text: info })
    for (const text of paginate(markdownToPatchouli(entry.body))) pages.push({ type: 'patchouli:text', text })
    if (!pages.length) pages.push({ type: 'patchouli:text', text: '（势力设定待补充）' })
    await addEntry('factions', safePath(entry.id, 'faction'), {
      name: entry.name ?? entry.id,
      icon: 'minecraft:shield',
      category: 'patchouli:factions',
      sortnum: Number(entry.order ?? 0),
      pages,
    })
  }
  for (const entry of locations) {
    const info = [
      entry.type ? `$(bold)类型$()：${entry.type}` : '',
      entry.coordinates ? `$(bold)坐标$()：${entry.coordinates}` : '',
      entry.description ? entry.description : '',
    ].filter(Boolean).join('$(br)')
    const pages = []
    if (info) pages.push({ type: 'patchouli:text', text: info })
    for (const text of paginate(markdownToPatchouli(entry.body))) pages.push({ type: 'patchouli:text', text })
    if (!pages.length) pages.push({ type: 'patchouli:text', text: '（地点设定待补充）' })
    await addEntry('locations', safePath(entry.id, 'location'), {
      name: entry.name ?? entry.id,
      icon: 'minecraft:map',
      category: 'patchouli:locations',
      sortnum: Number(entry.order ?? 0),
      pages,
    })
  }
  for (const entry of items) {
    const exportedItemId = itemIds.get(entry.id)
    const pages = [{ type: 'patchouli:spotlight', item: exportedItemId, title: entry.name ?? entry.id, text: (entry.lore ?? []).join('$(br)') }]
    for (const text of paginate(markdownToPatchouli(entry.body))) pages.push({ type: 'patchouli:text', text })
    const recipe = recipes.find((candidate) => candidate.id === entry.recipe)
    if (recipe) {
      const recipeId = recipeIds.get(recipe.id)
      if (recipeId) pages.push({ type: 'patchouli:crafting', recipe: recipeId, title: '合成配方' })
    } else if (entry.recipe) {
      warnings.push(`物品 ${entry.id} 引用的配方 ${entry.recipe} 不存在，未生成合成页面`)
    }
    await addEntry('items', safePath(entry.id, 'item'), {
      name: entry.name ?? entry.id,
      icon: exportedItemId,
      category: 'patchouli:items',
      sortnum: Number(entry.order ?? 0),
      pages,
    })
  }

  return {
    outDir: bookRoot,
    files,
    bookId: `patchouli:${bookId}`,
    giveCommand: `/give @p patchouli:guide_book[patchouli:book="patchouli:${bookId}"]`,
    summary: `Patchouli 书 ${bookId}：${files.length} 个文件（${enabledCategories.map((category) => category.name).join('、')}）`,
    warnings,
    stats: { categories: enabledCategories.length, entries: lore.length + stories.length + characters.length + factions.length + locations.length + items.length, bookId: `patchouli:${bookId}` },
  }
}

// ---------------------------------------------------------------------------
// KubeJS items + static recipes
// ---------------------------------------------------------------------------

function resolveItemRef(value, itemIds, namespace) {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  if (text.startsWith('#')) return { tag: text.slice(1) }
  if (text.includes(':')) return { item: text }
  const mapped = itemIds.get(text)
  if (mapped) return { item: mapped }
  return { item: `${namespace}:${safePath(text, 'item')}` }
}

/**
 * Export item designs to a KubeJS startup script and recipe designs to static
 * datapack recipe JSON under `data/<namespace>/recipe/` (deterministic ids that
 * Patchouli crafting pages can reference).
 */
export async function exportKubeJs({ config, project, designRoot, outDir, namespace }) {
  const warnings = []
  const files = []
  const ns = safeNamespace(project?.id ?? namespace, config?.defaultNamespace)
  const items = await loadAll(designRoot, 'item')
  const recipes = await loadAll(designRoot, 'recipe')

  const itemIds = new Map()
  for (const item of items) {
    const itemNs = safeNamespace(item.namespace, ns)
    const path = safePath(item.id, 'item')
    itemIds.set(item.id, `${itemNs}:${path}`)
    if (path !== String(item.id).toLowerCase()) warnings.push(`物品 ${item.id} 的 id 含非法字符，导出为 ${itemNs}:${path}`)
  }

  const lines = [
    '// Generated by CraftWorkshop — KubeJS startup script.',
    '// 物品注册在游戏启动时执行一次；新增/修改物品后必须重启游戏。',
    '// 纹理需另放：kubejs/assets/<namespace>/textures/item/<path>.png',
    "StartupEvents.registry('item', event => {",
  ]
  const RARITIES = ['common', 'uncommon', 'rare', 'epic']
  for (const item of items) {
    const id = itemIds.get(item.id)
    lines.push(`  event.create('${id}')`)
    if (item.name) lines.push(`    .displayName(${JSON.stringify(String(item.name))})`)
    if (item.rarity && RARITIES.includes(String(item.rarity))) lines.push(`    .rarity('${item.rarity}')`)
    lines[lines.length - 1] += ''
  }
  lines.push('})')
  lines.push('')
  await mkdir(join(outDir, 'startup_scripts'), { recursive: true })
  await writeFile(join(outDir, 'startup_scripts', 'craftworkshop_items.js'), `${lines.join('\n')}\n`, 'utf8')
  files.push('startup_scripts/craftworkshop_items.js')

  const recipeDir = join(outDir, 'data', ns, 'recipe')
  await mkdir(recipeDir, { recursive: true })
  for (const recipe of recipes) {
    const path = safePath(recipe.id, 'recipe')
    const output = (() => {
      const text = String(recipe.output ?? '').trim()
      if (!text) return undefined
      if (text.includes(':')) return { id: text, count: Number(recipe.count ?? 1) }
      const mapped = itemIds.get(text)
      if (!mapped) {
        warnings.push(`配方 ${recipe.id} 的产物 ${text} 不是已导出的物品设计 id，已跳过`)
        return undefined
      }
      return { id: mapped, count: Number(recipe.count ?? 1) }
    })()
    if (!output) continue
    const type = String(recipe.type ?? '')
    const inputs = Array.isArray(recipe.inputs) ? recipe.inputs : []
    let json
    if (type === 'shaped') {
      const pattern = Array.isArray(recipe.pattern) ? recipe.pattern.map(String) : []
      const key = {}
      for (const [symbol, ref] of Object.entries(recipe.key ?? {})) {
        const resolved = resolveItemRef(ref, itemIds, ns)
        if (resolved) key[symbol] = resolved
      }
      if (!pattern.length || !Object.keys(key).length) {
        warnings.push(`配方 ${recipe.id} 缺少 pattern/key，已跳过`)
        continue
      }
      json = { type: 'minecraft:crafting_shaped', pattern, key, result: output }
    } else if (type === 'shapeless') {
      const ingredients = inputs.map((input) => resolveItemRef(input, itemIds, ns)).filter(Boolean)
      if (!ingredients.length) {
        warnings.push(`配方 ${recipe.id} 缺少 inputs，已跳过`)
        continue
      }
      json = { type: 'minecraft:crafting_shapeless', ingredients, result: output }
    } else if (['smelting', 'blasting', 'smoking', 'campfire'].includes(type)) {
      const ingredient = resolveItemRef(inputs[0] ?? recipe.input, itemIds, ns)
      if (!ingredient) {
        warnings.push(`配方 ${recipe.id} 缺少输入物品，已跳过`)
        continue
      }
      const typeMap = { smelting: 'minecraft:smelting', blasting: 'minecraft:blasting', smoking: 'minecraft:smoking', campfire: 'minecraft:campfire_cooking' }
      json = { type: typeMap[type], ingredient, result: output, experience: Number(recipe.experience ?? 0.1), cookingtime: Number(recipe.cookingTime ?? (type === 'smelting' ? 200 : 100)) }
    } else if (type === 'stonecutting') {
      const ingredient = resolveItemRef(inputs[0] ?? recipe.input, itemIds, ns)
      if (!ingredient) {
        warnings.push(`配方 ${recipe.id} 缺少输入物品，已跳过`)
        continue
      }
      json = { type: 'minecraft:stonecutting', ingredient, result: output }
    } else if (type === 'smithing') {
      const template = resolveItemRef(recipe.template, itemIds, ns)
      const base = resolveItemRef(recipe.base ?? inputs[0], itemIds, ns)
      const addition = resolveItemRef(recipe.addition ?? inputs[1], itemIds, ns)
      if (!template || !base || !addition) {
        warnings.push(`配方 ${recipe.id} 的 smithing 需要 template/base/addition 字段，已跳过`)
        continue
      }
      json = { type: 'minecraft:smithing_transform', template, base, addition, result: output }
    } else {
      warnings.push(`配方 ${recipe.id} 的类型 "${type}" 暂不支持导出，已跳过`)
      continue
    }
    const fileName = `${path}.json`
    await writeFile(join(recipeDir, fileName), `${JSON.stringify(json, null, 2)}\n`, 'utf8')
    files.push(`data/${ns}/recipe/${fileName}`)
  }

  return {
    outDir,
    files,
    summary: `KubeJS：${items.length} 个物品注册 + ${files.length - 1} 个静态配方 JSON（namespace ${ns}）`,
    warnings,
    stats: { items: items.length, recipes: files.length - 1, namespace: ns, textureHint: `kubejs/assets/${ns}/textures/item/<path>.png` },
  }
}
