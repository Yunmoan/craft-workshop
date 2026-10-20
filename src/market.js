/**
 * Marketplace: browse Modrinth by curated categories and install the result either
 * into the project mod list (mods) or into a server's plugins directory (plugins).
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getBytes, sha1Of } from './util.js'
import { getProjectVersions, pickVersion, primaryFile, searchProjects } from './modrinth.js'

/** Curated marketplace shelves; each maps to a Modrinth query + sensible filters. */
export const MARKET_CATEGORIES = [
  { id: 'performance', label: '性能优化', type: 'mod', keywords: 'optimization performance fps', sort: 'downloads' },
  { id: 'client-qol', label: '客户端体验', type: 'mod', keywords: 'ui hud minimap inventory qol', sort: 'downloads' },
  { id: 'rpg', label: '幻想 RPG', type: 'mod', keywords: 'rpg fantasy magic adventure boss', sort: 'downloads' },
  { id: 'tech', label: '科技机械', type: 'mod', keywords: 'tech automation machines energy', sort: 'downloads' },
  { id: 'building', label: '建筑装饰', type: 'mod', keywords: 'building decoration furniture', sort: 'downloads' },
  { id: 'farming', label: '农业食物', type: 'mod', keywords: 'farming food cooking crops', sort: 'downloads' },
  { id: 'world', label: '世界生成', type: 'mod', keywords: 'world generation biome structures', sort: 'downloads' },
  { id: 'mobs', label: '生物与敌人', type: 'mod', keywords: 'mobs creatures enemies boss', sort: 'downloads' },
  { id: 'library', label: '前置库', type: 'mod', keywords: 'library api core framework', sort: 'downloads' },
  { id: 'server-plugin', label: '服务端插件', type: 'plugin', keywords: 'permissions protection economy essentials', loaders: ['paper', 'spigot', 'purpur'], sort: 'downloads' },
  { id: 'proxy-plugin', label: '代理插件', type: 'plugin', keywords: 'proxy velocity bungeecord', loaders: ['velocity', 'waterfall', 'bungeecord'], sort: 'downloads' },
]

export function marketCategories() {
  return MARKET_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    type: category.type,
    keywords: category.keywords,
    loaders: category.loaders ?? [],
  }))
}

/**
 * Search the marketplace. A category preset contributes keywords and default filters;
 * explicit arguments override them.
 */
export async function marketSearch(config, opts, signal) {
  const { category, query, projectType, loaders, gameVersions, limit = 12, offset = 0, sortBy, side } = opts
  const preset = MARKET_CATEGORIES.find((item) => item.id === category)
  const keywords = [preset?.keywords, query].filter(Boolean).join(' ')
  const result = await searchProjects(
    config,
    {
      query: keywords,
      projectType: projectType ?? preset?.type ?? 'mod',
      loaders: loaders?.length ? loaders : (preset?.loaders ?? []),
      gameVersions: gameVersions ?? [],
      limit: Math.min(Math.max(Number(limit) || 12, 1), 50),
      offset: Number(offset) || 0,
      index: sortBy ?? preset?.sort ?? 'relevance',
    },
    signal,
  )
  let hits = result.hits
  if (side === 'client') hits = hits.filter((hit) => hit.clientSide !== 'unsupported')
  if (side === 'server') hits = hits.filter((hit) => hit.serverSide !== 'unsupported')
  return { ...result, hits, category: preset?.id ?? '', keywords }
}

/**
 * Download Modrinth plugin jars into a server's `plugins/` directory.
 * Plugins are matched on the given game version and plugin loaders (paper/velocity/…).
 */
export async function installServerPlugins(config, opts, signal) {
  const { refs, serverDir, gameVersion, loaders = ['paper'], overwrite = false } = opts
  if (!refs?.length) throw new Error('install-plugins 需要 refs')
  const pluginsDir = join(serverDir, 'plugins')
  await mkdir(pluginsDir, { recursive: true })
  const installed = []
  const failed = []
  for (const ref of refs) {
    const [idPart] = String(ref).split('@')
    try {
      const versions = await getProjectVersions(config, idPart, { gameVersions: [gameVersion], loaders }, signal)
      const version = pickVersion(versions)
      if (!version) throw new Error(`没有匹配 ${gameVersion}/${loaders.join('/')} 的版本`)
      const file = primaryFile(version)
      if (!file?.url) throw new Error('版本没有可下载文件')
      const target = join(pluginsDir, file.filename)
      const exists = await stat(target).then(() => true).catch(() => false)
      if (exists && !overwrite) {
        installed.push({ ref: idPart, title: version.name, filename: file.filename, path: target, status: 'already-present' })
        continue
      }
      const bytes = await getBytes(file.url, { config, signal, timeoutMs: 120000 })
      if (file.hashes?.sha1 && sha1Of(bytes) !== file.hashes.sha1) throw new Error('sha1 校验失败')
      await writeFile(target, bytes)
      installed.push({ ref: idPart, title: version.name, version: version.version_number, filename: file.filename, size: bytes.length, path: target, status: 'installed' })
    } catch (error) {
      failed.push({ ref: idPart, reason: error.message })
    }
  }
  return { serverDir: pluginsDir, installed, failed }
}
