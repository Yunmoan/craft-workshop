/**
 * Design content system: story chapters, quests, characters, factions, locations,
 * lore, items and recipes authored as JSON under `design/<kind>/<id>.json`.
 *
 * The files are the source of truth; `mc_export` turns them into game files
 * (FTB Quests / Patchouli / KubeJS / design wiki).
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const DESIGN_KINDS = {
  character: {
    dir: 'characters',
    label: '人物设定',
    titleField: 'name',
    required: ['name'],
    fields: ['id', 'name', 'title', 'faction', 'tags', 'status', 'appearance', 'personality', 'background', 'relationships', 'body'],
    description: '角色档案：身份、性格、背景、关系网、正文档案。`faction` 引用 faction id；`relationships[].character` 引用 character id。',
    example: {
      id: 'character-sample',
      name: '示例人物',
      title: '示例称号',
      faction: 'faction-sample',
      tags: ['主角'],
      status: 'active',
      appearance: '外貌描写',
      personality: '性格描写',
      background: '背景故事',
      relationships: [{ character: 'character-other', relation: '师徒' }],
      body: '人物档案正文（Markdown）。',
    },
  },
  faction: {
    dir: 'factions',
    label: '势力/派系',
    titleField: 'name',
    required: ['name'],
    fields: ['id', 'name', 'type', 'leader', 'territory', 'allies', 'enemies', 'description', 'body'],
    description: '势力、种族、神明体系等。`leader` 引用 character id；`allies`/`enemies` 引用 faction id。',
    example: {
      id: 'faction-sample',
      name: '示例势力',
      type: '组织',
      leader: 'character-sample',
      territory: 'location-sample',
      allies: [],
      enemies: [],
      description: '势力简介',
      body: '势力设定正文（Markdown）。',
    },
  },
  location: {
    dir: 'locations',
    label: '地点/地图',
    titleField: 'name',
    required: ['name'],
    fields: ['id', 'name', 'region', 'type', 'coordinates', 'description', 'body'],
    description: '地点、区域、建筑、副本。`region` 可为上级地点 id；`coordinates` 为游戏内坐标或维度描述。',
    example: {
      id: 'location-sample',
      name: '示例地点',
      region: '',
      type: '城镇',
      coordinates: '维度: minecraft:overworld / X:0 Y:64 Z:0',
      description: '地点简介',
      body: '地点与地图设计正文（Markdown）。',
    },
  },
  lore: {
    dir: 'lore',
    label: '世界观条目',
    titleField: 'title',
    required: ['title'],
    fields: ['id', 'title', 'category', 'tags', 'body'],
    description: '世界观设定条目：创世、历史、魔法体系、种族、宗教等。`category` 用于分组（history/magic/religion…）。',
    example: {
      id: 'lore-sample',
      title: '示例世界观条目',
      category: 'history',
      tags: ['纪元'],
      body: '世界观正文（Markdown）。',
    },
  },
  story_chapter: {
    dir: 'story',
    label: '剧情章节',
    titleField: 'title',
    required: ['title', 'order'],
    fields: ['id', 'title', 'order', 'summary', 'characters', 'factions', 'locations', 'questChapter', 'tags', 'body'],
    description: '线性/分支剧情章节。`characters`/`factions`/`locations` 引用对应 id；`questChapter` 绑定任务章节 id；`body` 为章节正文（Markdown，可用 ## 场景分隔）。',
    example: {
      id: 'story-01',
      title: '第一章 · 示例章节',
      order: 1,
      summary: '一句话简介',
      characters: ['character-sample'],
      factions: ['faction-sample'],
      locations: ['location-sample'],
      questChapter: 'chapter-01',
      tags: ['主线'],
      body: '## 场景一\n剧情正文……\n\n## 场景二\n……',
    },
  },
  quest_chapter: {
    dir: 'quests',
    label: '任务章节',
    titleField: 'title',
    required: ['title', 'quests'],
    fields: ['id', 'title', 'order', 'group', 'groupTitle', 'icon', 'description', 'subtitle', 'quests'],
    description:
      '任务章节，导出为 FTB Quests。`quests[]` 每项：id、title、subtitle、description、x、y、dependencies（任务 id）、tasks、rewards。' +
      '任务类型 item/kill/checkmark/advancement/stat/observation；奖励类型 item/xp/command/loot/choice。',
    example: {
      id: 'chapter-01',
      title: '第一章 · 示例任务线',
      order: 1,
      group: 'main',
      icon: 'minecraft:written_book',
      description: '任务章节简介',
      quests: [
        {
          id: 'q-001',
          title: '苏醒',
          subtitle: '',
          description: '与神秘来客对话。',
          x: 0,
          y: 0,
          shape: 'circle',
          size: 1,
          dependencies: [],
          tasks: [{ type: 'checkmark' }],
          rewards: [{ type: 'xp', xp: 10 }],
        },
      ],
    },
  },
  item: {
    dir: 'items',
    label: '物品设计',
    titleField: 'name',
    required: ['name'],
    fields: ['id', 'name', 'namespace', 'lore', 'rarity', 'tags', 'recipe', 'body'],
    description: '自定义物品设计（可导出 KubeJS 注册草稿）。`namespace` 默认 inherit 项目；`recipe` 引用 recipe id。',
    example: {
      id: 'item-sample',
      name: '示例物品',
      namespace: 'ipthmc',
      lore: ['示例描述'],
      rarity: 'rare',
      tags: ['武器'],
      recipe: 'recipe-sample',
      body: '设计说明正文（Markdown）。',
    },
  },
  recipe: {
    dir: 'recipes',
    label: '配方设计',
    titleField: 'name',
    required: ['name', 'type'],
    fields: ['id', 'name', 'type', 'output', 'inputs', 'notes'],
    description: '自定义配方设计。`type` 为 shaped/shapeless/smelting/smithing/custom；output/inputs 可为物品设计 id（导出时替换为物品 id）或 `namespace:item` 原版/模组物品。',
    example: {
      id: 'recipe-sample',
      name: '示例配方',
      type: 'shaped',
      pattern: ['AAA', 'BBB', 'CCC'],
      key: { A: 'minecraft:iron_ingot' },
      output: 'item-sample',
      count: 1,
      inputs: ['minecraft:iron_ingot'],
      notes: '设计说明',
    },
  },
}

export const DESIGN_KIND_NAMES = Object.keys(DESIGN_KINDS)

const ID_PATTERN = /^[A-Za-z0-9._\-\u4e00-\u9fa5]{1,64}$/

export function designKindMeta(kind) {
  const meta = DESIGN_KINDS[kind]
  if (!meta) throw new Error(`未知的设计类型 "${kind}"，可选：${DESIGN_KIND_NAMES.join(', ')}`)
  return meta
}

export function designKindDir(root, kind) {
  return join(root, designKindMeta(kind).dir)
}

function entryPath(root, kind, id) {
  if (!ID_PATTERN.test(String(id ?? ''))) {
    throw new Error(`非法 id "${id}"：只允许字母/数字/汉字/点/下划线/中划线，长度 1-64，且不能包含路径分隔符`)
  }
  return join(designKindDir(root, kind), `${id}.json`)
}

function sortNumber(data) {
  const value = Number(data?.order)
  return Number.isFinite(value) ? value : 9999
}

function titleOf(kind, data) {
  return String(data?.[DESIGN_KINDS[kind].titleField] ?? data?.id ?? '未命名')
}

function summarize(kind, data) {
  const base = { id: data.id, title: titleOf(kind, data), order: data.order }
  if (kind === 'quest_chapter') {
    base.quests = Array.isArray(data.quests) ? data.quests.length : 0
  }
  if (kind === 'story_chapter') {
    base.characters = Array.isArray(data.characters) ? data.characters.length : 0
    base.hasBody = Boolean(data.body)
  }
  if (kind === 'character') base.faction = data.faction ?? ''
  if (kind === 'item') base.namespace = data.namespace ?? ''
  if (kind === 'recipe') base.type = data.type ?? ''
  return base
}

export async function listEntries(root, kind) {
  const meta = designKindMeta(kind)
  const dir = join(root, meta.dir)
  let names = []
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'))
  } catch (error) {
    if (error.code === 'ENOENT') return { kind, dir: meta.dir, entries: [], warnings: [] }
    throw error
  }
  const entries = []
  const warnings = []
  for (const name of names) {
    try {
      const data = JSON.parse(await readFile(join(dir, name), 'utf8'))
      entries.push(summarize(kind, data))
    } catch (error) {
      warnings.push(`${meta.dir}/${name} 解析失败：${error.message}`)
    }
  }
  entries.sort((a, b) => sortNumber(a) - sortNumber(b) || String(a.id).localeCompare(String(b.id)))
  return { kind, dir: meta.dir, entries, warnings }
}

export async function getEntry(root, kind, id) {
  const path = entryPath(root, kind, id)
  try {
    const data = JSON.parse(await readFile(path, 'utf8'))
    return { path, data }
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`设计条目不存在：${kind}/${id}（${path}）`)
    if (error instanceof SyntaxError) throw new Error(`设计条目 JSON 解析失败：${path} — ${error.message}`)
    throw error
  }
}

/**
 * Create or merge a design entry. Top-level fields in `data` replace existing ones;
 * nested values are replaced wholesale (no deep merge) to keep edits predictable.
 */
export async function writeEntry(root, kind, id, data, { replace = false } = {}) {
  const meta = designKindMeta(kind)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data 必须是 JSON 对象')
  const path = entryPath(root, kind, id)
  let existing
  try {
    existing = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    existing = undefined
  }
  const now = new Date().toISOString()
  const next = replace || !existing
    ? { ...data, id }
    : { ...existing, ...data, id }
  if (!next.createdAt && existing?.createdAt) next.createdAt = existing.createdAt
  if (!next.createdAt) next.createdAt = now
  next.updatedAt = now
  // Bookkeeping fields last so callers cannot spoof them.
  next.id = id

  const validation = validateEntry(kind, next)
  await mkdir(join(root, meta.dir), { recursive: true })
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return { path, created: !existing, data: next, validation }
}

export async function deleteEntry(root, kind, id) {
  const path = entryPath(root, kind, id)
  try {
    await rm(path)
    return { path, deleted: true }
  } catch (error) {
    if (error.code === 'ENOENT') return { path, deleted: false }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const TASK_TYPES = ['item', 'kill', 'checkmark', 'advancement', 'stat', 'observation', 'xp', 'dimension', 'biome']
const REWARD_TYPES = ['item', 'xp', 'command', 'loot', 'choice', 'random']

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function checkQuest(quest, index, errors, warnings, prefix) {
  const label = `${prefix}quests[${index}]`
  if (!quest || typeof quest !== 'object') {
    errors.push(`${label} 必须是对象`)
    return
  }
  if (!quest.id) errors.push(`${label} 缺少 id`)
  if (!quest.title) warnings.push(`${label} 缺少 title`)
  if (quest.dependencies !== undefined && !isStringArray(quest.dependencies)) errors.push(`${label}.dependencies 必须是字符串数组`)
  for (const field of ['tasks', 'rewards']) {
    if (quest[field] === undefined) continue
    if (!Array.isArray(quest[field])) {
      errors.push(`${label}.${field} 必须是数组`)
      continue
    }
    quest[field].forEach((item, itemIndex) => {
      const itemLabel = `${label}.${field}[${itemIndex}]`
      if (!item || typeof item !== 'object') {
        errors.push(`${itemLabel} 必须是对象`)
        return
      }
      const allowed = field === 'tasks' ? TASK_TYPES : REWARD_TYPES
      if (!item.type) errors.push(`${itemLabel} 缺少 type`)
      else if (!allowed.includes(item.type)) warnings.push(`${itemLabel} 的 type "${item.type}" 不在已知类型（${allowed.join('/')}）中，导出时可能被忽略`)
      if (item.type === 'item' && !item.item) errors.push(`${itemLabel} 需要 item 字段`)
      if (item.type === 'kill' && !item.entity) errors.push(`${itemLabel} 需要 entity 字段`)
    })
  }
}

export function validateEntry(kind, data) {
  const meta = designKindMeta(kind)
  const errors = []
  const warnings = []
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['条目必须是 JSON 对象'], warnings }
  }
  if (!data.id) errors.push('缺少 id（必须与文件名一致）')
  for (const field of meta.required) {
    const value = data[field]
    if (value === undefined || value === null || value === '') errors.push(`缺少必填字段 ${field}`)
    else if (field === 'order' && !Number.isFinite(Number(value))) errors.push('order 必须是数字')
    else if (field === 'quests' && !Array.isArray(value)) errors.push('quests 必须是数组')
  }
  for (const field of ['tags', 'characters', 'factions', 'locations', 'allies', 'enemies', 'lore', 'inputs']) {
    if (data[field] !== undefined && !isStringArray(data[field])) errors.push(`${field} 必须是字符串数组`)
  }
  if (data.relationships !== undefined) {
    if (!Array.isArray(data.relationships)) errors.push('relationships 必须是数组')
    else {
      data.relationships.forEach((relation, index) => {
        if (!relation || typeof relation !== 'object' || !relation.character) errors.push(`relationships[${index}] 需要 character 字段`)
      })
    }
  }
  if (kind === 'story_chapter' && !data.body) warnings.push('story_chapter 建议填写 body（章节正文）')
  if (kind === 'quest_chapter') {
    if (Array.isArray(data.quests)) {
      if (!data.quests.length) warnings.push('quest_chapter 还没有任何任务')
      const seen = new Set()
      data.quests.forEach((quest, index) => {
        checkQuest(quest, index, errors, warnings, '')
        if (quest?.id) {
          if (seen.has(quest.id)) errors.push(`quests 里 id "${quest.id}" 重复`)
          seen.add(quest.id)
        }
      })
    }
  }
  if (kind === 'recipe' && data.type !== undefined && !['shaped', 'shapeless', 'smelting', 'blasting', 'smoking', 'campfire', 'smithing', 'stonecutting', 'custom'].includes(data.type)) {
    warnings.push(`recipe.type "${data.type}" 不在常见类型中`)
  }
  return { ok: errors.length === 0, errors, warnings }
}

/** Cross-reference validation over the whole design tree. */
export async function checkDesign(root) {
  const errors = []
  const warnings = []
  const info = []
  const stats = {}
  const ids = {}
  const data = {}

  for (const kind of DESIGN_KIND_NAMES) {
    const listed = await listEntries(root, kind)
    stats[kind] = listed.entries.length
    warnings.push(...listed.warnings)
    ids[kind] = new Set()
    data[kind] = new Map()
    for (const entry of listed.entries) {
      ids[kind].add(entry.id)
      try {
        const full = await getEntry(root, kind, entry.id)
        data[kind].set(entry.id, full.data)
        const validation = validateEntry(kind, full.data)
        errors.push(...validation.errors.map((message) => `[${kind}/${entry.id}] ${message}`))
        warnings.push(...validation.warnings.map((message) => `[${kind}/${entry.id}] ${message}`))
      } catch (error) {
        errors.push(`[${kind}/${entry.id}] ${error.message}`)
      }
    }
  }

  const ref = (kind, id, context, { optional = false } = {}) => {
    if (!id) return
    if (!ids[kind]?.has(id)) {
      const message = `[${context}] 引用的 ${kind} "${id}" 不存在`
      if (optional) warnings.push(message)
      else errors.push(message)
    }
  }

  for (const [id, character] of data.character ?? []) {
    if (character.faction) ref('faction', character.faction, `character/${id}`)
    for (const relation of character.relationships ?? []) ref('character', relation?.character, `character/${id}`)
  }
  for (const [id, faction] of data.faction ?? []) {
    if (faction.leader) ref('character', faction.leader, `faction/${id}`)
  }
  for (const [id, story] of data.story_chapter ?? []) {
    for (const character of story.characters ?? []) ref('character', character, `story/${id}`)
    for (const faction of story.factions ?? []) ref('faction', faction, `story/${id}`)
    for (const location of story.locations ?? []) ref('location', location, `story/${id}`)
    if (story.questChapter) ref('quest_chapter', story.questChapter, `story/${id}`)
  }
  for (const [id, chapter] of data.quest_chapter ?? []) {
    const questIds = new Set((chapter.quests ?? []).map((quest) => quest?.id).filter(Boolean))
    for (const quest of chapter.quests ?? []) {
      for (const dependency of quest.dependencies ?? []) {
        const [chapterPart, questPart] = String(dependency).includes(':') ? String(dependency).split(':') : [id, String(dependency)]
        if (chapterPart === id) {
          if (!questIds.has(questPart)) errors.push(`[quest_chapter/${id}/${quest.id}] 依赖的任务 "${questPart}" 不在本章节`)
        } else if (!ids.quest_chapter.has(chapterPart)) {
          errors.push(`[quest_chapter/${id}/${quest.id}] 跨章节依赖 "${dependency}" 的章节不存在`)
        }
      }
    }
    if (!(data.story_chapter && [...data.story_chapter.values()].some((story) => story.questChapter === id))) {
      warnings.push(`[quest_chapter/${id}] 没有剧情章节绑定这个任务章节（story_chapter.questChapter）`)
    }
  }
  for (const [id, item] of data.item ?? []) {
    if (item.recipe) ref('recipe', item.recipe, `item/${id}`)
  }
  for (const [id, recipe] of data.recipe ?? []) {
    for (const output of [recipe.output, ...(recipe.inputs ?? [])]) {
      if (!output) continue
      if (String(output).includes(':')) continue // external registry id (minecraft:..., mod:...) cannot be checked here
      if (!ids.item.has(String(output))) warnings.push(`[recipe/${id}] 物品引用 "${output}" 不是本项目的物品设计 id，导出时会当作外部 id`)
    }
  }

  // Coverage information (not errors).
  const usedCharacters = new Set()
  for (const story of data.story_chapter?.values() ?? []) for (const character of story.characters ?? []) usedCharacters.add(character)
  const unusedCharacters = [...ids.character].filter((id) => !usedCharacters.has(id))
  if (unusedCharacters.length) info.push(`以下人物尚未出现在任何剧情章节：${unusedCharacters.join(', ')}`)
  const storyOrders = [...(data.story_chapter?.values() ?? [])].map((story) => Number(story.order)).filter(Number.isFinite)
  if (storyOrders.length) {
    const sorted = [...storyOrders].sort((a, b) => a - b)
    for (let index = 1; index < sorted.length; index++) {
      if (sorted[index] === sorted[index - 1]) warnings.push(`剧情章节 order 重复：${sorted[index]}`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    info,
    stats,
    total: Object.values(stats).reduce((sum, count) => sum + count, 0),
  }
}

// ---------------------------------------------------------------------------
// Design wiki export (Markdown)
// ---------------------------------------------------------------------------

function mdList(items, empty = '（无）') {
  if (!items?.length) return empty
  return items.map((item) => `- ${item}`).join('\n')
}

function mdField(label, value) {
  if (value === undefined || value === null || value === '') return ''
  return `- **${label}**：${Array.isArray(value) ? value.join('、') : value}`
}

function entityBlock(title, fields, body) {
  const lines = [`## ${title}`, '', ...fields.filter(Boolean), '']
  if (body) lines.push(body, '')
  return lines.join('\n')
}

/** Export a human-readable design wiki under `outDir`. */
export async function exportDesignWiki(root, outDir) {
  const sections = {}
  const counts = {}
  for (const kind of DESIGN_KIND_NAMES) {
    const listed = await listEntries(root, kind)
    counts[kind] = listed.entries.length
    const blocks = []
    const sorted = [...listed.entries].sort((a, b) => sortNumber(a) - sortNumber(b) || String(a.id).localeCompare(String(b.id)))
    for (const entry of sorted) {
      const { data } = await getEntry(root, kind, entry.id)
      if (kind === 'character') {
        blocks.push(
          entityBlock(`${data.name}`, [
            mdField('ID', data.id),
            mdField('称号', data.title),
            mdField('势力', data.faction),
            mdField('状态', data.status),
            mdField('标签', data.tags),
            mdField('外貌', data.appearance),
            mdField('性格', data.personality),
            mdField('背景', data.background),
            data.relationships?.length ? mdField('关系', data.relationships.map((relation) => `${relation.character}（${relation.relation ?? '关系'}）`)) : '',
          ].filter(Boolean), data.body),
        )
      } else if (kind === 'story_chapter') {
        blocks.push(
          entityBlock(`第 ${data.order} 章 · ${data.title}`, [
            mdField('ID', data.id),
            mdField('摘要', data.summary),
            mdField('人物', data.characters),
            mdField('势力', data.factions),
            mdField('地点', data.locations),
            mdField('任务章节', data.questChapter),
            mdField('标签', data.tags),
          ].filter(Boolean), data.body),
        )
      } else if (kind === 'quest_chapter') {
        const questLines = (data.quests ?? []).map((quest) => {
          const tasks = (quest.tasks ?? []).map((task) => task.type + (task.item ? `:${task.item}` : task.entity ? `:${task.entity}` : '')).join(', ')
          const rewards = (quest.rewards ?? []).map((reward) => reward.type).join(', ')
          const depends = quest.dependencies?.length ? ` ⟵ 依赖 ${quest.dependencies.join(', ')}` : ''
          const desc = quest.description ? ` — ${String(quest.description).replace(/\n/g, ' / ')}` : ''
          return `- **${quest.id} · ${quest.title ?? '未命名'}**（任务：${tasks || '无'}；奖励：${rewards || '无'}）${depends}${desc}`
        })
        blocks.push(
          entityBlock(`任务章节 ${data.order ?? ''} · ${data.title}`, [
            mdField('ID', data.id),
            mdField('分组', data.group),
            mdField('图标', data.icon),
            mdField('简介', data.description),
          ].filter(Boolean), `${questLines.join('\n') || '（无任务）'}`),
        )
      } else if (kind === 'item') {
        blocks.push(
          entityBlock(`${data.name}`, [
            mdField('ID', data.id),
            mdField('命名空间', data.namespace),
            mdField('稀有度', data.rarity),
            mdField('标签', data.tags),
            mdField('描述', data.lore),
            mdField('配方', data.recipe),
          ].filter(Boolean), data.body),
        )
      } else if (kind === 'recipe') {
        blocks.push(
          entityBlock(`${data.name}`, [
            mdField('ID', data.id),
            mdField('类型', data.type),
            mdField('产物', data.output),
            mdField('材料', data.inputs),
            mdField('备注', data.notes),
          ].filter(Boolean)),
        )
      } else if (kind === 'faction') {
        blocks.push(
          entityBlock(`${data.name}`, [
            mdField('ID', data.id),
            mdField('类型', data.type),
            mdField('领袖', data.leader),
            mdField('势力范围', data.territory),
            mdField('盟友', data.allies),
            mdField('敌人', data.enemies),
            mdField('简介', data.description),
          ].filter(Boolean), data.body),
        )
      } else if (kind === 'location') {
        blocks.push(
          entityBlock(`${data.name}`, [
            mdField('ID', data.id),
            mdField('区域', data.region),
            mdField('类型', data.type),
            mdField('坐标', data.coordinates),
            mdField('简介', data.description),
          ].filter(Boolean), data.body),
        )
      } else if (kind === 'lore') {
        blocks.push(entityBlock(`${data.title}`, [mdField('ID', data.id), mdField('分类', data.category), mdField('标签', data.tags)].filter(Boolean), data.body))
      }
    }
    sections[kind] = `${blocks.join('\n---\n\n') || '（暂无内容）'}\n`
  }

  const files = {}
  const kindToFile = {
    character: 'characters.md',
    faction: 'factions.md',
    location: 'locations.md',
    lore: 'lore.md',
    story_chapter: 'story.md',
    quest_chapter: 'quests.md',
    item: 'items.md',
    recipe: 'recipes.md',
  }
  for (const [kind, filename] of Object.entries(kindToFile)) {
    files[filename] = `# ${DESIGN_KINDS[kind].label}\n\n> 由 CraftWorkshop 从 \`design/${DESIGN_KINDS[kind].dir}/\` 生成，请勿直接编辑本文件。\n\n${sections[kind]}`
  }
  const index = [
    `# 设计文档索引`,
    '',
    `> 由 CraftWorkshop 从 \`${root}\` 生成。改设计请改 \`design/<kind>/<id>.json\`，再重新导出。`,
    '',
    '| 类型 | 数量 | 文档 |',
    '|---|---|---|',
    ...DESIGN_KIND_NAMES.map((kind) => `| ${DESIGN_KINDS[kind].label} | ${counts[kind]} | [${kindToFile[kind]}](${kindToFile[kind]}) |`),
    '',
  ].join('\n')
  files['README.md'] = index

  await mkdir(outDir, { recursive: true })
  for (const [filename, content] of Object.entries(files)) {
    await writeFile(join(outDir, filename), content, 'utf8')
  }
  return { outDir, files: Object.keys(files), counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) }
}

/** Create the design directory tree + a JSON template for every kind. */
export async function ensureDesignScaffold(root) {
  await mkdir(root, { recursive: true })
  for (const meta of Object.values(DESIGN_KINDS)) await mkdir(join(root, meta.dir), { recursive: true })
  await mkdir(join(root, '_templates'), { recursive: true })
  await writeFile(
    join(root, 'README.md'),
    [
      '# 设计内容目录',
      '',
      '这是整合包的内容源（source of truth）：剧情、任务、人物、势力、地点、世界观、物品与配方。',
      '所有条目都是 JSON 文件，路径为 `design/<kind>/<id>.json`；推荐通过 Agent 的 `mc_design` 工具增删改查，或直接编辑 JSON。',
      '',
      '| kind | 目录 | 说明 |',
      '|---|---|---|',
      ...Object.entries(DESIGN_KINDS).map(([kind, meta]) => `| \`${kind}\` | \`${meta.dir}/\` | ${meta.label}：${meta.description} |`),
      '',
      '## 工作流',
      '',
      '1. `mc_design action=write kind=character id=xxx data={...}` 编写内容；',
      '2. `mc_design action=check` 校验字段与交叉引用；',
      '3. `mc_export target=all` 导出 FTB Quests / Patchouli / KubeJS / 设计文档；',
      '4. `mc_build` 从 `project.json` 构建 `.mrpack`。',
      '',
      '## 模板',
      '',
      '`design/_templates/` 下为每种类型的空白模板（不会被校验或导出）。',
      '',
    ].join('\n'),
    'utf8',
  )
  for (const [kind, meta] of Object.entries(DESIGN_KINDS)) {
    await writeFile(join(root, '_templates', `${kind}.json`), `${JSON.stringify(meta.example, null, 2)}\n`, 'utf8')
  }
  return { root, kinds: DESIGN_KIND_NAMES }
}
