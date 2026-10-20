/**
 * Modrinth API v2 client: resource search, project/version lookups and dependency resolution.
 * https://docs.modrinth.com/api/
 */
import { buildUrl, formatDate, getJson, parseRef, queryValue } from './util.js'

export const MODRINTH_API = 'https://api.modrinth.com/v2'

/** Loader names as used by Modrinth categories/version loaders. */
export const LOADERS = ['neoforge', 'forge', 'fabric', 'quilt', 'paper', 'purpur', 'folia', 'velocity', 'waterfall', 'bungeecord', 'spigot', 'bukkit']

export const PROJECT_TYPES = ['mod', 'plugin', 'modpack', 'resourcepack', 'shader', 'datapack']

const PROJECT_FIELDS = [
  'id',
  'slug',
  'title',
  'description',
  'project_type',
  'client_side',
  'server_side',
  'categories',
  'versions',
  'game_versions',
  'loaders',
  'downloads',
  'followers',
  'icon_url',
  'source_url',
  'issues_url',
  'license',
  'published',
  'updated',
  'team',
].join(',')

/**
 * Search projects. Loaders are expressed as Modrinth categories facets.
 * @param {object} config plugin config
 * @param {{query?: string, projectType?: string, loaders?: string[], gameVersions?: string[], limit?: number, offset?: number, index?: string}} opts
 */
export async function searchProjects(config, opts, signal) {
  const {
    query = '',
    projectType = 'mod',
    loaders = [],
    gameVersions = [],
    categories = [],
    limit = 10,
    offset = 0,
    index = 'relevance',
  } = opts
  const facets = []
  if (projectType) facets.push([`project_type:${projectType}`])
  // Loader and content categories share the Modrinth `categories` facet; a group is OR,
  // groups are AND, so each list becomes its own group.
  const categoryValues = [...loaders, ...categories]
  if (categoryValues.length) facets.push(categoryValues.map((value) => `categories:${value}`))
  if (gameVersions.length) facets.push(gameVersions.map((version) => `versions:${version}`))
  const url = buildUrl(MODRINTH_API, '/search', {
    query,
    index,
    limit: String(Math.min(Math.max(limit, 1), 100)),
    offset: String(Math.max(offset, 0)),
    facets: queryValue(facets),
  })
  const result = await getJson(url, { config, signal })
  return {
    totalHits: result.total_hits,
    offset: result.offset,
    limit: result.limit,
    hits: (result.hits ?? []).map((hit) => ({
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      projectType: hit.project_type,
      author: hit.author,
      downloads: hit.downloads,
      follows: hit.follows,
      categories: hit.display_categories ?? hit.categories,
      versions: hit.versions,
      clientSide: hit.client_side,
      serverSide: hit.server_side,
      updated: hit.date_modified,
      iconUrl: hit.icon_url,
      latestVersion: hit.latest_version,
    })),
  }
}

export async function getProject(config, idOrSlug, signal) {
  const url = buildUrl(MODRINTH_API, `/project/${encodeURIComponent(idOrSlug)}`, {})
  const project = await getJson(url, { config, signal })
  return {
    ...project,
    projectId: project.id,
  }
}

export async function getProjectVersions(config, idOrSlug, filters, signal) {
  const { gameVersions = [], loaders = [] } = filters ?? {}
  const params = {}
  if (gameVersions.length) params.game_versions = queryValue(gameVersions)
  if (loaders.length) params.loaders = queryValue(loaders)
  const url = buildUrl(MODRINTH_API, `/project/${encodeURIComponent(idOrSlug)}/version`, params)
  const versions = await getJson(url, { config, signal })
  return Array.isArray(versions) ? versions : []
}

export async function getVersion(config, versionId, signal) {
  const url = buildUrl(MODRINTH_API, `/version/${encodeURIComponent(versionId)}`, {})
  return getJson(url, { config, signal })
}

export async function getProjects(config, ids, signal) {
  if (!ids.length) return []
  const url = buildUrl(MODRINTH_API, '/projects', { ids: queryValue(ids) })
  const projects = await getJson(url, { config, signal })
  return Array.isArray(projects) ? projects : []
}

/** Primary downloadable file of a Modrinth version (falls back to the first file). */
export function primaryFile(version) {
  const files = version?.files ?? []
  return files.find((file) => file.primary) ?? files[0]
}

export function fileSha1(file) {
  const hashes = file?.hashes ?? {}
  return hashes.sha1 ?? hashes.sha512 ?? ''
}

/** Pick the newest release if present, else the newest version. */
export function pickVersion(versions, preferRelease = true) {
  if (!versions?.length) return undefined
  if (preferRelease) {
    const release = versions.find((version) => version.version_type === 'release')
    if (release) return release
  }
  return versions[0]
}

function summarizeVersion(version) {
  const file = primaryFile(version)
  return {
    versionId: version.id,
    versionNumber: version.version_number,
    versionName: version.name,
    versionType: version.version_type,
    gameVersions: version.game_versions,
    loaders: version.loaders,
    datePublished: version.date_published,
    downloads: version.downloads,
    filename: file?.filename,
    url: file?.url,
    size: file?.size,
    sha1: file?.hashes?.sha1,
    sha512: file?.hashes?.sha512,
    dependencies: (version.dependencies ?? []).map((dep) => ({
      projectId: dep.project_id,
      versionId: dep.version_id,
      dependencyType: dep.dependency_type,
      fileName: dep.file_name,
    })),
  }
}

export { summarizeVersion }

/**
 * Resolve a set of project references into a complete install plan.
 *
 * Refs accept `slug`, `projectId`, `slug@versionId`, or `projectId@versionId`.
 * Required dependencies are followed transitively (optional ones only when asked).
 */
export async function resolvePlan(config, opts, signal) {
  const {
    refs,
    gameVersion = config.defaultGameVersion ?? '1.21.1',
    loader = config.defaultLoader ?? 'neoforge',
    includeOptional = false,
    maxDepth = Number(config.maxDependencyDepth ?? 6),
  } = opts

  const plan = new Map()
  const warnings = []
  const queue = []
  for (const ref of refs) {
    const parsed = parseRef(ref)
    if (!parsed.id) {
      warnings.push(`忽略空引用：${ref}`)
      continue
    }
    queue.push({ id: parsed.id, versionId: parsed.versionId, depth: 0, direct: true })
  }

  const projectCache = new Map()
  const versionCache = new Map()
  const filteredVersionsCache = new Map()
  const gameVersions = gameVersion ? [gameVersion] : []
  const loaders = loader ? [loader] : []

  async function loadProject(id) {
    const key = String(id)
    if (!projectCache.has(key)) {
      projectCache.set(
        key,
        getProject(config, id, signal).catch((error) => {
          projectCache.delete(key)
          throw error
        }),
      )
    }
    return projectCache.get(key)
  }

  async function loadVersion(versionId) {
    if (!versionCache.has(versionId)) versionCache.set(versionId, await getVersion(config, versionId, signal))
    return versionCache.get(versionId)
  }

  async function loadMatchingVersions(projectId) {
    if (!filteredVersionsCache.has(projectId)) {
      filteredVersionsCache.set(projectId, await getProjectVersions(config, projectId, { gameVersions, loaders }, signal))
    }
    return filteredVersionsCache.get(projectId)
  }

  while (queue.length) {
    const item = queue.shift()
    let project
    try {
      project = await loadProject(item.id)
    } catch (error) {
      warnings.push(`无法获取项目 ${item.id}：${error.message}`)
      continue
    }
    let version
    try {
      if (item.versionId) {
        version = await loadVersion(item.versionId)
      } else {
        const candidates = await loadMatchingVersions(project.id)
        version = pickVersion(candidates)
        if (!version) {
          warnings.push(`${project.title}（${project.slug}）没有匹配 ${gameVersion ?? '任意版本'}/${loader ?? '任意加载器'} 的版本`)
          continue
        }
      }
    } catch (error) {
      warnings.push(`无法获取 ${project.slug} 的版本：${error.message}`)
      continue
    }
    const existing = plan.get(project.id)
    if (existing) {
      if (existing.versionId !== version.id) {
        warnings.push(
          `版本冲突：${project.title} 已解析为 ${existing.versionNumber}，另有一处要求 ${version.version_number}（保留前者，请人工确认）`,
        )
      }
      continue
    }
    const summary = summarizeVersion(version)
    plan.set(project.id, {
      projectId: project.id,
      slug: project.slug,
      title: project.title,
      description: project.description,
      projectType: project.project_type,
      clientSide: project.client_side,
      serverSide: project.server_side,
      iconUrl: project.icon_url,
      ...summary,
      depth: item.depth,
      direct: item.direct,
    })
    if (item.depth >= maxDepth) {
      warnings.push(`依赖层级超过 ${maxDepth}，已停止展开 ${project.title} 的下级依赖`)
      continue
    }
    for (const dep of version.dependencies ?? []) {
      if (dep.dependency_type === 'incompatible') {
        warnings.push(`不兼容声明：${project.title} 与 ${dep.project_id ?? dep.file_name ?? '未知项目'} 不兼容`)
        continue
      }
      if (dep.dependency_type !== 'required' && !(includeOptional && dep.dependency_type === 'optional')) continue
      if (!dep.project_id) {
        warnings.push(`外部依赖无法自动解析：${project.title} 需要 ${dep.file_name ?? '未知文件'}`)
        continue
      }
      queue.push({ id: dep.project_id, versionId: dep.version_id ?? undefined, depth: item.depth + 1, direct: false })
    }
  }

  const entries = [...plan.values()]
  entries.sort((a, b) => (a.direct === b.direct ? a.depth - b.depth || a.title.localeCompare(b.title) : a.direct ? -1 : 1))
  return { entries, warnings, gameVersion, loader }
}

/** Render a one-line "+" summary of a version's dependencies. */
export function dependencySummary(version) {
  const deps = version?.dependencies ?? []
  if (!deps.length) return '-'
  return deps
    .map((dep) => `${dep.dependency_type ?? 'required'}:${dep.project_id?.slice(0, 8) ?? dep.file_name ?? '?'}`)
    .join(' ')
}

/** Common display fields for one search hit. */
export function describeHit(hit) {
  return {
    title: hit.title,
    slug: hit.slug,
    downloads: hit.downloads,
    updated: formatDate(hit.updated),
    description: hit.description,
  }
}
