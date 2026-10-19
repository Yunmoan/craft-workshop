/**
 * .mrpack (Modrinth modpack format) builder and reader.
 * Format reference: https://docs.modrinth.com/modpacks/format
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createZip, readZip } from './zip.js'
import { getBytes, sha1Of } from './util.js'
import { resolvePlan } from './modrinth.js'
import { fabricLoaderVersions, forgeVersions, neoforgeVersions, pickFabricLoader } from './loaders.js'

/** Convert any dependency side value to mrpack env vocabulary. */
function envValue(side) {
  if (side === 'unsupported') return 'unsupported'
  if (side === 'optional') return 'optional'
  return 'required'
}

/** Recursively walk a directory and return [{relativePath, absolutePath}]. */
export async function walkFiles(root, prefix = '') {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name === 'desktop.ini' || entry.name === 'Thumbs.db') continue
    const absolutePath = join(root, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...(await walkFiles(absolutePath, relativePath)))
    else if (entry.isFile()) files.push({ relativePath, absolutePath })
  }
  return files
}

function loaderDependencyKey(loader) {
  if (loader === 'neoforge') return 'neoforge'
  if (loader === 'forge') return 'forge'
  if (loader === 'fabric') return 'fabric-loader'
  if (loader === 'quilt') return 'quilt-loader'
  return loader
}

async function resolveLoaderVersion(config, loader, gameVersion, pinned) {
  if (pinned) return pinned
  if (loader === 'neoforge') {
    const { items } = await neoforgeVersions(config, gameVersion, undefined, 1)
    if (!items.length) throw new Error(`找不到 Minecraft ${gameVersion} 对应的 NeoForge 版本`)
    return items[0].version
  }
  if (loader === 'fabric') {
    const { items } = await fabricLoaderVersions(config, gameVersion, undefined, 10)
    const loaderPick = pickFabricLoader(items)
    if (!loaderPick) throw new Error(`找不到 Minecraft ${gameVersion} 对应的 Fabric Loader 版本`)
    return loaderPick.version
  }
  if (loader === 'forge') {
    const { items } = await forgeVersions(config, gameVersion, undefined)
    if (!items.length) throw new Error(`找不到 Minecraft ${gameVersion} 的 Forge 版本`)
    return items[0].version
  }
  return undefined
}

/**
 * Build an .mrpack archive from resolved Modrinth projects.
 * @param {object} config plugin config
 * @param {object} opts build options
 * @param {AbortSignal} signal
 */
export async function buildMrpack(config, opts, signal) {
  const {
    name,
    versionId,
    summary = '',
    projects,
    gameVersion = config.defaultGameVersion ?? '1.21.1',
    loader = config.defaultLoader ?? 'neoforge',
    loaderVersion,
    outputPath,
    overridesDir,
    clientOverridesDir,
    serverOverridesDir,
    includeOptional = false,
    extraFiles = [],
  } = opts

  const { entries, warnings } = await resolvePlan(
    config,
    { refs: projects, gameVersion, loader, includeOptional },
    signal,
  )
  if (!entries.length) throw new Error('没有解析到任何可打包的项目，请检查 mc_resolve 的输出与项目引用')

  const files = []
  const skipped = []
  const usedPaths = new Set()
  for (const entry of entries) {
    if (entry.projectType !== 'mod') {
      skipped.push(`${entry.title}（${entry.projectType}）不是 mod；.mrpack 的 files[] 只能放 mods/ 下的文件，请改用 overrides 手动放置`)
      continue
    }
    if (!entry.url || !entry.filename) {
      warnings.push(`${entry.title} 的版本没有可下载文件，已跳过`)
      continue
    }
    let path = `mods/${entry.filename}`
    if (usedPaths.has(path)) {
      path = `mods/${entry.slug}-${entry.filename}`
      if (usedPaths.has(path)) {
        warnings.push(`${entry.title} 与其他项目文件名冲突，已跳过 ${entry.filename}`)
        continue
      }
    }
    usedPaths.add(path)
    files.push({
      path,
      hashes: { sha1: entry.sha1, sha512: entry.sha512 },
      env: { client: envValue(entry.clientSide), server: envValue(entry.serverSide) },
      downloads: [entry.url],
      fileSize: entry.size,
    })
  }

  const resolvedLoaderVersion = await resolveLoaderVersion(config, loader, gameVersion, loaderVersion)
  const dependencies = { minecraft: gameVersion }
  const key = loaderDependencyKey(loader)
  if (resolvedLoaderVersion && key) dependencies[key] = resolvedLoaderVersion

  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: versionId || `${name}-${new Date().toISOString().slice(0, 10)}`,
    name,
    ...(summary ? { summary } : {}),
    files,
    dependencies,
  }

  const zipEntries = [
    { name: 'modrinth.index.json', data: Buffer.from(`${JSON.stringify(index, null, 2)}\n`, 'utf8'), compress: true },
  ]

  async function addOverrides(directory, targetPrefix) {
    if (!directory) return 0
    let exists = false
    try {
      exists = (await stat(directory)).isDirectory()
    } catch {
      exists = false
    }
    if (!exists) {
      warnings.push(`overrides 目录不存在，已忽略：${directory}`)
      return 0
    }
    const filesFound = await walkFiles(directory)
    for (const file of filesFound) {
      zipEntries.push({
        name: `${targetPrefix}/${file.relativePath}`,
        data: await readFile(file.absolutePath),
        compress: true,
      })
    }
    return filesFound.length
  }

  const overrideCount =
    (await addOverrides(overridesDir, 'overrides')) +
    (await addOverrides(clientOverridesDir, 'client-overrides')) +
    (await addOverrides(serverOverridesDir, 'server-overrides'))

  // Project content mappings (exported FTB Quests / Patchouli / KubeJS files).
  let contentCount = 0
  for (const extra of extraFiles) {
    if (!extra?.absolutePath || !extra?.zipPath) continue
    zipEntries.push({
      name: String(extra.zipPath).replace(/^\/+/, ''),
      data: await readFile(extra.absolutePath),
      compress: true,
    })
    contentCount += 1
  }

  const archive = createZip(zipEntries)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, archive)

  return {
    outputPath,
    size: archive.length,
    sha1: sha1Of(archive),
    files: files.length,
    overrides: overrideCount,
    contentFiles: contentCount,
    dependencies,
    index,
    entryCount: entries.length,
    skipped,
    warnings,
  }
}

/** Read and parse an .mrpack archive's modrinth.index.json. */
export async function readMrpack(packPath) {
  const archive = await readFile(packPath)
  const entries = readZip(archive)
  const indexRaw = entries.get('modrinth.index.json')
  if (!indexRaw) throw new Error(`不是合法的 .mrpack：缺少 modrinth.index.json（${packPath}）`)
  const index = JSON.parse(indexRaw.toString('utf8'))
  return { index, entries }
}

/** Server-relevant files listed in an .mrpack index (env.server !== "unsupported"). */
export function serverFilesOf(index) {
  return (index.files ?? []).filter((file) => (file.env?.server ?? 'required') !== 'unsupported')
}

/**
 * Install the server side of an .mrpack into a server directory.
 * Downloads mods/* entries (sha1 verified) and extracts overrides/ + server-overrides/.
 */
export async function installMrpackToServer(config, opts, signal) {
  const { packPath, serverDir, overwrite = false, includeOverrides = true, dryRun = false } = opts
  const { index, entries } = await readMrpack(packPath)
  const files = serverFilesOf(index)
  const downloaded = []
  const skipped = []
  const failed = []
  const overrides = []
  let bytes = 0

  for (const file of files) {
    const target = join(serverDir, file.path)
    const url = file.downloads?.[0]
    let existingSha1
    try {
      existingSha1 = sha1Of(await readFile(target))
    } catch {
      existingSha1 = undefined
    }
    if (existingSha1) {
      if (existingSha1 === file.hashes?.sha1) {
        skipped.push({ path: file.path, reason: 'already-present' })
        continue
      }
      if (!overwrite) {
        failed.push({
          path: file.path,
          reason: `sha1 不匹配（已有 ${existingSha1.slice(0, 12)}…，期望 ${String(file.hashes?.sha1).slice(0, 12)}…），未覆盖`,
        })
        continue
      }
    }
    if (dryRun) {
      downloaded.push({ path: file.path, url, dryRun: true })
      continue
    }
    try {
      if (!url) throw new Error('缺少下载 URL')
      const buffer = await getBytes(url, {
        config,
        signal,
        timeoutMs: Math.max(60000, Number(config.requestTimeoutMs ?? 20000) * 3),
      })
      const actual = sha1Of(buffer)
      if (file.hashes?.sha1 && actual !== file.hashes.sha1) {
        throw new Error(`sha1 校验失败（期望 ${file.hashes.sha1}，实际 ${actual}）`)
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, buffer)
      bytes += buffer.length
      downloaded.push({ path: file.path, bytes: buffer.length })
    } catch (error) {
      failed.push({ path: file.path, reason: error.message })
    }
  }

  if (includeOverrides) {
    for (const [name, data] of entries.entries()) {
      let relative
      if (name.startsWith('overrides/')) relative = name.slice('overrides/'.length)
      else if (name.startsWith('server-overrides/')) relative = name.slice('server-overrides/'.length)
      else continue
      if (!relative || relative.endsWith('/')) continue
      const target = join(serverDir, relative)
      if (dryRun) {
        overrides.push({ path: relative, status: 'dry-run' })
        continue
      }
      try {
        if (!overwrite) {
          try {
            await readFile(target)
            overrides.push({ path: relative, status: 'skipped' })
            continue
          } catch {
            /* target does not exist yet */
          }
        }
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, data)
        overrides.push({ path: relative, status: 'written' })
      } catch (error) {
        failed.push({ path: relative, reason: error.message })
      }
    }
  }

  return {
    packPath,
    serverDir,
    expected: files.length,
    downloaded,
    skipped,
    failed,
    overrides,
    bytes,
    dryRun,
  }
}
