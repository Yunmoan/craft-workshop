/**
 * Loader / Minecraft version metadata for NeoForge, Fabric, Paper, Velocity and Arclight.
 * Every URL here was verified against the live service during development.
 */
import { getJson, getText } from './util.js'

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const FABRIC_META = 'https://meta.fabricmc.net/v2'
const FABRIC_MAVEN = 'https://maven.fabricmc.net'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge'
const PAPER_API = 'https://fill.papermc.io/v3'
const ARCLIGHT_RELEASES = 'https://api.github.com/repos/IzzelAliz/Arclight/releases'

export const LOADER_KINDS = ['minecraft', 'neoforge', 'forge', 'fabric', 'paper', 'velocity', 'arclight']

/** Compare dotted numeric versions descending (26.3.0.92 > 26.3.0.89 > 21.1.263). */
export function compareVersionsDesc(a, b) {
  const pa = String(a).split(/[.\-+]/).map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN))
  const pb = String(b).split(/[.\-+]/).map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN))
  const length = Math.max(pa.length, pb.length)
  for (let index = 0; index < length; index++) {
    const va = Number.isNaN(pa[index]) ? -1 : pa[index] ?? -1
    const vb = Number.isNaN(pb[index]) ? -1 : pb[index] ?? -1
    if (va !== vb) return vb - va
  }
  return String(b).localeCompare(String(a))
}

/**
 * NeoForge version prefix for a Minecraft version.
 * MC 1.x: NeoForge drops the leading "1." (1.21.1 -> 21.1., 1.21.11 -> 21.11.).
 * MC 26.x: NeoForge keeps the full MC prefix (26.3 -> 26.3., 26.1.2 -> 26.1.2.).
 * MC 1.20.1 uses the legacy `net.neoforged:forge` artifact (handled by callers).
 */
export function neoforgePrefix(gameVersion) {
  const version = String(gameVersion)
  const parts = version.split('.').map(Number)
  if (!Number.isFinite(parts[0])) return null
  if (parts[0] === 1) {
    if (version === '1.20.1') return '47.1.'
    const major = parts[1] ?? 0
    const minor = parts[2] ?? 0
    return `${major}.${minor}.`
  }
  return `${version}.`
}

export async function minecraftVersions(config, signal, limit = 20) {
  const data = await getJson(MOJANG_MANIFEST, { config, signal, ttlMs: 6 * 60 * 60 * 1000 })
  return {
    latest: data.latest,
    versions: (data.versions ?? []).slice(0, limit).map((version) => ({
      id: version.id,
      type: version.type,
      releaseTime: version.release_time ?? version.releaseTime,
    })),
  }
}

export async function neoforgeVersions(config, gameVersion, signal, limit = 15) {
  const prefix = neoforgePrefix(gameVersion)
  if (!prefix) throw new Error(`无法从 Minecraft 版本 "${gameVersion}" 推导 NeoForge 版本前缀`)
  const xml = await getText(`${NEOFORGE_MAVEN}/maven-metadata.xml`, { config, signal })
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1])
  const matching = versions
    .filter((version) => version.startsWith(prefix))
    .filter((version) => !/-(alpha|beta)/i.test(version) && !version.includes('+snapshot'))
    .sort(compareVersionsDesc)
  const items = matching.slice(0, limit).map((version) => ({
    version,
    installerUrl: `${NEOFORGE_MAVEN}/${version}/neoforge-${version}-installer.jar`,
  }))
  return { prefix, items, total: matching.length }
}

export async function fabricLoaderVersions(config, gameVersion, signal, limit = 15) {
  const data = await getJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}`, { config, signal })
  const rows = Array.isArray(data) ? data : []
  const items = rows
    .map((row) => ({ version: row.loader?.version, stable: Boolean(row.loader?.stable) }))
    .filter((row) => row.version)
    .sort((a, b) => compareVersionsDesc(a.version, b.version))
    .slice(0, limit)
  return { items, total: rows.length }
}

/** Pick the newest stable Fabric Loader, falling back to the newest item. */
export function pickFabricLoader(items) {
  return items.find((item) => item.stable) ?? items[0]
}

export async function fabricInstaller(config, signal) {
  const data = await getJson(`${FABRIC_META}/versions/installer`, { config, signal })
  const rows = Array.isArray(data) ? data : []
  const stable = rows.find((row) => row.stable) ?? rows[0]
  return stable ? { version: stable.version, url: stable.url } : undefined
}

/** Forge promotions (recommended/latest per Minecraft version) + installer URLs. */
export async function forgeVersions(config, gameVersion, signal) {
  const data = await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', {
    config,
    signal,
    ttlMs: 30 * 60 * 1000,
  })
  const promos = data?.promos ?? {}
  const latest = promos[`${gameVersion}-latest`]
  const recommended = promos[`${gameVersion}-recommended`]
  const items = []
  if (recommended) items.push({ version: recommended, channel: 'recommended' })
  if (latest && latest !== recommended) items.push({ version: latest, channel: 'latest' })
  const installerFor = (forgeVersion) =>
    `https://maven.minecraftforge.net/net/minecraftforge/forge/${gameVersion}-${forgeVersion}/forge-${gameVersion}-${forgeVersion}-installer.jar`
  return {
    gameVersion,
    items: items.map((item) => ({ ...item, installerUrl: installerFor(item.version) })),
  }
}

function paperBuildItems(builds) {
  return (Array.isArray(builds) ? builds : []).map((build) => {
    const download = build.downloads?.['server:default'] ?? Object.values(build.downloads ?? {})[0]
    return {
      build: build.id,
      channel: build.channel,
      time: build.time,
      name: download?.name,
      url: download?.url,
      size: download?.size,
      sha256: download?.checksums?.sha256,
    }
  })
}

/** List versions known to the PaperMC v3 API for project "paper" or "velocity". */
export async function paperProjectVersions(config, project, signal) {
  const data = await getJson(`${PAPER_API}/projects/${encodeURIComponent(project)}`, { config, signal })
  const flattened = []
  for (const group of Object.values(data.versions ?? {})) {
    for (const version of group ?? []) flattened.push(version)
  }
  return { project: data.project, versions: flattened }
}

export async function paperBuilds(config, gameVersion, signal, project = 'paper') {
  const builds = await getJson(
    `${PAPER_API}/projects/${encodeURIComponent(project)}/versions/${encodeURIComponent(gameVersion)}/builds`,
    { config, signal },
  )
  return paperBuildItems(builds)
}

export async function velocityBuilds(config, velocityVersion, signal) {
  const builds = await getJson(
    `${PAPER_API}/projects/velocity/versions/${encodeURIComponent(velocityVersion)}/builds`,
    { config, signal },
  )
  return paperBuildItems(builds)
}

/** Arclight hybrid server releases from GitHub (NeoForge/Forge/Fabric variants). */
export async function arclightReleases(config, gameVersion, signal, variant = 'neoforge') {
  const response = await getJson(`${ARCLIGHT_RELEASES}?per_page=50`, { config, signal })
  const releases = Array.isArray(response) ? response : []
  const wanted = []
  for (const release of releases) {
    for (const asset of release.assets ?? []) {
      const match = /^arclight-(neoforge|forge|fabric)-(\d+\.\d+(?:\.\d+)?)-(.+)\.jar$/.exec(asset.name)
      if (!match) continue
      if (gameVersion && match[2] !== gameVersion) continue
      if (variant && match[1] !== variant && !(variant === 'neoforge' && match[1] === 'forge')) continue
      wanted.push({
        release: release.tag_name,
        channel: release.prerelease ? 'beta' : 'release',
        publishedAt: release.published_at,
        variant: match[1],
        gameVersion: match[2],
        version: match[3].replace(/-[0-9a-f]{7,}$/i, ''),
        filename: asset.name,
        size: asset.size,
        url: asset.browser_download_url,
      })
    }
  }
  const variantRank = (item) => (item.variant === variant ? 0 : item.variant === 'neoforge' ? 1 : item.variant === 'forge' ? 2 : 3)
  wanted.sort((a, b) => compareVersionsDesc(a.version, b.version) || variantRank(a) - variantRank(b) || a.filename.localeCompare(b.filename))
  return { items: wanted, notes: [] }
}

/**
 * Unified loader metadata lookup used by the mc_loader tool.
 */
export async function loaderInfo(config, opts, signal) {
  const { kind, gameVersion = config.defaultGameVersion ?? '1.21.1', version, limit = 12, variant } = opts
  switch (kind) {
    case 'minecraft': {
      const { latest, versions } = await minecraftVersions(config, signal, limit)
      return {
        kind,
        latest,
        items: versions.map((item) => ({ version: item.id, channel: item.type, date: item.releaseTime })),
      }
    }
    case 'neoforge': {
      const { prefix, items, total } = await neoforgeVersions(config, gameVersion, signal, limit)
      return {
        kind,
        gameVersion,
        match: `${prefix}*`,
        total,
        items: items.map((item) => ({ version: item.version, url: item.installerUrl })),
        notes: ['NeoForge 服务端需先运行 installer（java -jar neoforge-<ver>-installer.jar --installServer），再使用生成的 run.sh。'],
      }
    }
    case 'fabric': {
      const { items, total } = await fabricLoaderVersions(config, gameVersion, signal, limit)
      const installer = await fabricInstaller(config, signal)
      const recommended = pickFabricLoader(items)
      return {
        kind,
        gameVersion,
        total,
        recommended: recommended?.version,
        items: items.map((item) => ({
          version: item.version,
          channel: item.stable ? 'stable' : 'unstable',
          serverJarUrl: `${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(item.version)}/server/jar`,
        })),
        installerUrl: installer?.url,
        notes: [
          'Fabric 服务端可用 "server/jar" 启动器 jar，或使用 fabric-installer 安装。',
          `本机建议使用稳定版 Loader${recommended ? `：${recommended.version}` : ''}。`,
        ],
      }
    }
    case 'forge': {
      const { items } = await forgeVersions(config, gameVersion, signal)
      return {
        kind,
        gameVersion,
        items: items.map((item) => ({
          version: item.version,
          channel: item.channel,
          url: item.installerUrl,
        })),
        notes: [
          'Forge 服务端需先运行 installer（java -jar forge-<mc>-<ver>-installer.jar --installServer），再使用生成的 run.sh。',
          'NeoForge 与 Forge 在 1.20.2+ 起互斥；MC 1.20.1 及以前的 NeoForge 使用 net.neoforged:forge legacy artifact。',
        ],
      }
    }
    case 'paper': {
      const builds = await paperBuilds(config, gameVersion, signal, 'paper')
      return {
        kind,
        gameVersion,
        items: builds.slice(0, limit).map((item) => ({
          version: `${gameVersion}-${item.build}`,
          channel: item.channel,
          date: item.time,
          url: item.url,
          fileName: item.name,
          sha256: item.sha256,
          size: item.size,
        })),
        notes: ['Paper 1.21.1 已进入 UNSUPPORTED 支持周期，仍可下载最新构建。'],
      }
    }
    case 'velocity': {
      if (version) {
        const builds = await velocityBuilds(config, version, signal)
        return {
          kind,
          version,
          items: builds.slice(0, limit).map((item) => ({
            version: `${version}-${item.build}`,
            channel: item.channel,
            date: item.time,
            url: item.url,
            fileName: item.name,
            sha256: item.sha256,
            size: item.size,
          })),
        }
      }
      const { versions } = await paperProjectVersions(config, 'velocity', signal)
      return {
        kind,
        items: versions.slice(0, limit).map((item) => ({ version: item, channel: item.includes('SNAPSHOT') ? 'snapshot' : 'stable' })),
        notes: ['Velocity 传 version 可查看具体构建；1.21.1 网络常用 3.4.0-SNAPSHOT。'],
      }
    }
    case 'arclight': {
      const targetVariant = variant ?? (config.defaultLoader === 'fabric' ? 'fabric' : 'neoforge')
      const { items } = await arclightReleases(config, gameVersion, signal, targetVariant)
      return {
        kind,
        gameVersion,
        variant: targetVariant,
        items: items.slice(0, limit).map((item) => ({
          version: `${item.variant}-${item.version}`,
          channel: item.channel,
          date: item.publishedAt,
          url: item.url,
          fileName: item.filename,
          size: item.size,
        })),
        notes: [
          'Arclight 是混合端（模组 + 插件），NeoForge 版本约 7MB；运行前需先安装对应加载器服务端，再把 Arclight jar 作为启动入口。',
          '同版本也可能提供 forge/fabric 变体，可用 variant 参数切换。',
        ],
      }
    }
    default:
      throw new Error(`未知的 loader 类型 "${kind}"，可选：${LOADER_KINDS.join(', ')}`)
  }
}
