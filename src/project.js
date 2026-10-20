/**
 * CraftWorkshop project model: the single source of truth for a modpack project.
 *
 * The project file lives in the workspace (default `project.json`) and owns the
 * mod list, target version/loader, pack overrides and content-export mappings.
 * Builds are outputs — authors edit the project, not the build.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildMrpack, walkFiles } from './mrpack.js'
import { resolvePlan } from './modrinth.js'
import { parseRef } from './util.js'

export const PROJECT_SCHEMA = 'craft-workshop-project/1'
export const PROJECT_FILE = 'project.json'
export const OVERRIDE_ZONES = ['overrides', 'client-overrides', 'server-overrides']

function slugify(text) {
  return (
    String(text ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'untitled-pack'
  )
}

export function defaultProject(name = '未命名整合包') {
  return {
    $schema: PROJECT_SCHEMA,
    name,
    id: slugify(name),
    website: '',
    description: '',
    target: {
      minecraft: '1.21.1',
      loader: 'neoforge',
      loaderVersion: '',
    },
    pack: {
      versionId: '0.1.0',
      summary: '',
      mods: [],
      overrides: {
        overrides: 'overrides',
        clientOverrides: '',
        serverOverrides: '',
      },
      content: [],
      outputDir: 'builds',
    },
    design: {
      root: 'design',
    },
    servers: {},
    operations: {},
  }
}

function normalizeMod(entry) {
  if (typeof entry === 'string') {
    const parsed = parseRef(entry)
    return parsed.versionId ? { id: parsed.id, versionId: parsed.versionId } : { id: parsed.id }
  }
  if (entry && typeof entry === 'object' && entry.id) {
    const mod = { id: String(entry.id) }
    if (entry.versionId) mod.versionId = String(entry.versionId)
    if (entry.note) mod.note = String(entry.note)
    return mod
  }
  return undefined
}

export function normalizeMods(mods) {
  const out = []
  const seen = new Set()
  for (const entry of Array.isArray(mods) ? mods : []) {
    const mod = normalizeMod(entry)
    if (!mod || seen.has(mod.id)) continue
    seen.add(mod.id)
    out.push(mod)
  }
  return out
}

export function modRef(mod) {
  return mod.versionId ? `${mod.id}@${mod.versionId}` : mod.id
}

export function modsRefs(project) {
  return normalizeMods(project?.pack?.mods).map(modRef)
}

export function normalizeProject(raw) {
  const base = defaultProject(raw?.name || raw?.project?.name || '未命名整合包')
  const merged = {
    ...base,
    ...raw,
    target: { ...base.target, ...(raw?.target ?? {}) },
    pack: {
      ...base.pack,
      ...(raw?.pack ?? {}),
      overrides: { ...base.pack.overrides, ...(raw?.pack?.overrides ?? {}) },
    },
    design: { ...base.design, ...(raw?.design ?? {}) },
  }
  // Legacy schema (`ipthmc.project.json` v0) kept the display name under `project.name`
  // and pointed at a single built pack under `pack.path`.
  if (raw?.project?.name && !raw?.name) merged.name = raw.project.name
  if (raw?.project?.description && !raw?.description) merged.description = raw.project.description
  if (raw?.project?.website && !raw?.website) merged.website = raw.project.website
  merged.pack.mods = normalizeMods(merged.pack.mods)
  merged.pack.content = Array.isArray(merged.pack.content)
    ? merged.pack.content.filter((item) => item && item.from).map((item) => ({
        from: String(item.from),
        to: String(item.to ?? ''),
        zone: OVERRIDE_ZONES.includes(item.zone) ? item.zone : 'overrides',
        optional: Boolean(item.optional),
      }))
    : []
  return merged
}

export async function readProject(filePath, { create = false, defaultName } = {}) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return normalizeProject(JSON.parse(raw))
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (!create) {
        throw new Error(`项目文件不存在：${filePath}。先用 mc_project action=init 初始化，或检查 path 参数。`)
      }
      const project = defaultProject(defaultName ? defaultName : '未命名整合包')
      await writeProject(filePath, project)
      return project
    }
    if (error instanceof SyntaxError) throw new Error(`项目文件 JSON 解析失败：${filePath} — ${error.message}`)
    throw error
  }
}

export async function writeProject(filePath, project) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
}

export function projectSummary(project) {
  const mods = normalizeMods(project.pack.mods)
  return {
    name: project.name,
    id: project.id,
    schema: project.$schema,
    description: project.description,
    target: project.target,
    versionId: project.pack.versionId,
    summary: project.pack.summary,
    mods: mods.map(modRef),
    modsCount: mods.length,
    pinnedCount: mods.filter((mod) => mod.versionId).length,
    designRoot: project.design?.root ?? 'design',
    outputDir: project.pack.outputDir ?? 'builds',
    overrides: project.pack.overrides,
    content: project.pack.content ?? [],
  }
}

export function addMods(project, refs) {
  const mods = normalizeMods(project.pack.mods)
  const added = []
  const existing = new Map(mods.map((mod) => [mod.id, mod]))
  for (const ref of refs) {
    const parsed = parseRef(ref)
    if (!parsed.id) continue
    if (existing.has(parsed.id)) {
      if (parsed.versionId && existing.get(parsed.id).versionId !== parsed.versionId) {
        existing.get(parsed.id).versionId = parsed.versionId
        added.push({ id: parsed.id, versionId: parsed.versionId, updated: true })
      }
      continue
    }
    const mod = normalizeMod(parsed.versionId ? { id: parsed.id, versionId: parsed.versionId } : { id: parsed.id })
    mods.push(mod)
    existing.set(mod.id, mod)
    added.push(mod)
  }
  project.pack.mods = mods
  return added
}

export function removeMods(project, refs) {
  const ids = new Set(refs.map((ref) => parseRef(ref).id))
  const before = normalizeMods(project.pack.mods)
  project.pack.mods = before.filter((mod) => !ids.has(mod.id))
  return before.filter((mod) => ids.has(mod.id)).map(modRef)
}

export function pinMod(project, ref, versionId) {
  const parsed = parseRef(ref)
  const mods = normalizeMods(project.pack.mods)
  const mod = mods.find((item) => item.id === parsed.id)
  if (!mod) throw new Error(`项目里没有模组 ${parsed.id}，先用 mc_mods action=add 添加`)
  const pinned = versionId || parsed.versionId
  if (!pinned) throw new Error('pin 需要 versionId 参数（或使用 slug@versionId 形式）')
  mod.versionId = pinned
  project.pack.mods = mods
  return mod
}

export function unpinMod(project, refs) {
  const ids = new Set(refs.map((ref) => parseRef(ref).id))
  const mods = normalizeMods(project.pack.mods)
  const changed = []
  for (const mod of mods) {
    if (ids.has(mod.id) && mod.versionId) {
      delete mod.versionId
      changed.push(mod.id)
    }
  }
  project.pack.mods = mods
  return changed
}

/** Collect files under the project's content mappings, ready to be added to a pack. */
export async function collectContentFiles(projectRoot, project) {
  const files = []
  const warnings = []
  const mappings = []
  for (const mapping of project.pack.content ?? []) {
    const sourceDir = resolve(projectRoot, mapping.from)
    const zone = OVERRIDE_ZONES.includes(mapping.zone) ? mapping.zone : 'overrides'
    const targetPrefix = String(mapping.to ?? '').replace(/^\/+|\/+$/g, '')
    let found = []
    try {
      found = await walkFiles(sourceDir)
    } catch {
      if (!mapping.optional) warnings.push(`内容导出目录不存在：${mapping.from}（先运行 mc_export）`)
      continue
    }
    for (const file of found) {
      const zipPath = [zone, targetPrefix, file.relativePath].filter(Boolean).join('/')
      files.push({ zipPath, absolutePath: file.absolutePath })
    }
    mappings.push({ ...mapping, zone, files: found.length })
  }
  return { files, warnings, mappings }
}

/** Resolve the project's mod list into an install plan (required dependencies included). */
export async function resolveProject(config, project, signal) {
  return resolvePlan(
    config,
    {
      refs: modsRefs(project),
      gameVersion: project.target.minecraft,
      loader: project.target.loader,
      includeOptional: false,
    },
    signal,
  )
}

/**
 * Build an .mrpack from the project file.
 * @param {object} config plugin config
 * @param {{projectRoot: string, projectPath: string, versionId?: string, outputPath?: string, includeOptional?: boolean}} opts
 */
export async function buildFromProject(config, opts, signal) {
  const project = await readProject(opts.projectPath)
  const versionId = opts.versionId ?? project.pack.versionId ?? '0.0.0'
  const outputDir = project.pack.outputDir ?? 'builds'
  const outputPath = opts.outputPath ?? resolve(opts.projectRoot, outputDir, `${slugify(project.name)}-${versionId}.mrpack`)
  const overrides = project.pack.overrides ?? {}
  const { files: extraFiles, warnings: contentWarnings, mappings } = await collectContentFiles(opts.projectRoot, project)

  const result = await buildMrpack(
    config,
    {
      name: project.name,
      versionId,
      summary: project.pack.summary ?? '',
      projects: modsRefs(project),
      gameVersion: project.target.minecraft,
      loader: project.target.loader,
      loaderVersion: project.target.loaderVersion || undefined,
      outputPath,
      overridesDir: overrides.overrides ? resolve(opts.projectRoot, overrides.overrides) : undefined,
      clientOverridesDir: overrides.clientOverrides ? resolve(opts.projectRoot, overrides.clientOverrides) : undefined,
      serverOverridesDir: overrides.serverOverrides ? resolve(opts.projectRoot, overrides.serverOverrides) : undefined,
      includeOptional: opts.includeOptional ?? false,
      extraFiles,
      clientOnlyProjects: project.client?.mods ?? [],
    },
    signal,
  )
  return { ...result, project, contentMappings: mappings, contentWarnings }
}
