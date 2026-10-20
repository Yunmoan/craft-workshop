/**
 * AI pack composition: role-based candidate gathering + validation.
 *
 * The plugin itself does not run an LLM; it gives an agent (or the Web UI) a
 * repeatable way to compose a modpack from roles/theme, rank candidates against the
 * project's target version + loader, validate the result through the dependency
 * resolver, and apply it to the project in one step.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { searchProjects } from './modrinth.js'
import { addMods } from './project.js'
import { formatDate } from './util.js'

/** Built-in composition roles; keywords feed a Modrinth search. */
export const COMPOSE_ROLES = [
  { id: 'library', label: '前置库', keyword: 'library', categories: ['library'], keywords: 'library api core framework', perRole: 3, note: '大多数内容模组的前置，先装减少依赖缺失' },
  { id: 'performance', label: '性能优化', keyword: 'optimization', categories: ['optimization'], keywords: 'optimization performance fps', perRole: 3 },
  { id: 'client', label: '客户端体验', keyword: 'minimap', categories: ['utility'], keywords: 'ui hud minimap inventory qol', perRole: 3 },
  { id: 'world', label: '世界生成', keyword: 'worldgen', categories: ['worldgen'], keywords: 'world generation biome structures', perRole: 3 },
  { id: 'rpg', label: '幻想 RPG', keyword: 'magic', categories: ['magic', 'adventure'], keywords: 'rpg fantasy magic adventure boss', perRole: 4 },
  { id: 'mobs', label: '生物与敌人', keyword: 'mobs', categories: ['mobs'], keywords: 'mobs creatures enemies boss', perRole: 3 },
  { id: 'tech', label: '科技机械', keyword: 'technology', categories: ['technology'], keywords: 'tech automation machine energy', perRole: 3 },
  { id: 'building', label: '建筑装饰', keyword: 'decoration', categories: ['decoration'], keywords: 'building decoration furniture', perRole: 3 },
  { id: 'farming', label: '农业食物', keyword: 'food', categories: ['food'], keywords: 'farming food cooking crops', perRole: 3 },
  { id: 'quest', label: '任务与引导', keyword: 'quests', categories: ['adventure'], keywords: 'quest progression guide book', perRole: 2 },
]

export function composeRoles() {
  return COMPOSE_ROLES.map((role) => ({ ...role }))
}

function roleOf(id) {
  return COMPOSE_ROLES.find((role) => role.id === id)
}

/**
 * Build a composition plan: for every role, search the target version/loader and take
 * the top candidates that are not already in the project.
 * @returns {{plan: object, path: string}}
 */
export async function composePlan(config, opts, signal) {
  const { project, roles, perRole, theme = '', avoid = [], must = [], planDir } = opts
  const gameVersions = [project.target.minecraft]
  const loaders = [project.target.loader]
  const existing = new Set()
  for (const mod of project.pack.mods ?? []) existing.add(mod.id)
  const picked = []
  const seen = new Set(existing)
  const roleStats = []

  for (const roleId of roles) {
    const role = roleOf(roleId)
    if (!role) continue
    const target = Math.max(1, Number(perRole) || role.perRole)
    // Modrinth 全文检索按整句匹配，多词短语命中很少；因此每个角色用单关键词检索，
    // 不够就回退到「分类 facets + 目标版本 + 加载器」按下载量取该类目热门模组。
    const themeIsCjk = /[\u3400-\u9fff]/.test(theme)
    const keyword = role.keyword || role.keywords.split(' ')[0]
    const primaryQuery = theme && !themeIsCjk ? `${theme} ${keyword}` : keyword
    const hits = []
    const usedQuery = primaryQuery
    try {
      const first = await searchProjects(
        config,
        { query: primaryQuery, projectType: 'mod', loaders, gameVersions, limit: Math.min(target * 6, 40), index: 'downloads' },
        signal,
      )
      hits.push(...first.hits)
      if (hits.length < target) {
        const second = await searchProjects(
          config,
          { query: '', projectType: 'mod', loaders, gameVersions, categories: role.categories ?? [], limit: Math.min(target * 6, 40), index: 'downloads' },
          signal,
        )
        for (const hit of second.hits) {
          if (!hits.some((item) => item.projectId === hit.projectId)) hits.push(hit)
        }
      }
    } catch (error) {
      roleStats.push({ role: role.id, label: role.label, picked: 0, query: usedQuery, error: error.message })
      continue
    }
    let taken = 0
    for (const hit of hits) {
      if (taken >= target) break
      if (seen.has(hit.slug) || seen.has(hit.projectId)) continue
      if (avoid.some((text) => hit.slug.includes(text) || hit.title.toLowerCase().includes(String(text).toLowerCase()))) continue
      seen.add(hit.slug)
      seen.add(hit.projectId)
      picked.push({
        role: role.id,
        roleLabel: role.label,
        slug: hit.slug,
        title: hit.title,
        downloads: hit.downloads,
        clientSide: hit.clientSide,
        serverSide: hit.serverSide,
        updated: hit.updated,
        description: hit.description,
      })
      taken += 1
    }
    roleStats.push({ role: role.id, label: role.label, picked: taken, query: usedQuery, error: '' })
  }

  for (const ref of must) {
    const text = String(ref).trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    picked.push({ role: 'must', roleLabel: '指定必装', slug: text, title: text, downloads: 0, clientSide: '?', serverSide: '?', must: true })
  }

  const plan = {
    id: `compose-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    createdAt: new Date().toISOString(),
    project: project.name,
    projectId: project.id,
    target: { ...project.target },
    theme,
    themeNote: theme ? (/[\u3400-\u9fff]/.test(theme) ? '主题为中文：Modrinth 检索使用角色的英文关键词，主题仅作为方案元数据' : '') : '',
    perRole: Number(perRole) || 0,
    roles,
    roleStats,
    entries: picked,
  }
  let path
  if (planDir) {
    await mkdir(planDir, { recursive: true })
    path = join(planDir, `${plan.id}.json`)
    await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  }
  return { plan, path }
}

export async function readComposePlan(planDir, planRef) {
  const file = planRef.endsWith('.json') ? planRef : join(planDir, `${planRef}.json`)
  const data = JSON.parse(await readFile(file, 'utf8'))
  return { plan: data, path: file }
}

/** Apply a plan (or an explicit ref list) to the project mod list. */
export function applyComposition(project, { plan, refs }) {
  const list = refs?.length ? refs : (plan?.entries ?? []).map((entry) => entry.slug)
  return { refs: list, added: addMods(project, list) }
}

export function renderPlanTable(plan) {
  return (plan.entries ?? []).map((entry) => [
    entry.roleLabel ?? entry.role,
    entry.slug,
    entry.title,
    entry.downloads ? String(entry.downloads) : '-',
    entry.clientSide ?? '?',
    entry.serverSide ?? '?',
    entry.updated ? formatDate(entry.updated) : '-',
  ])
}
