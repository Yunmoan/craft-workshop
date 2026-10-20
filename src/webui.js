/**
 * Web UI backend for CraftWorkshop: a local-only HTTP API over the project managers.
 *
 * Routes (all under /craft-workshop/api):
 *   GET  /state                     project dashboard snapshot
 *   GET  /design?kind=&id=          design list or one entry
 *   POST /design                    { action: 'write'|'delete'|'check' }
 *   POST /export                    { target }
 *   POST /build                     { versionId?, includeOptional? }
 *   GET  /mods?resolve=1            project mod list, optionally resolved
 *   POST /mods                      { action: 'add'|'remove'|'pin'|'unpin', refs, versionId }
 *   GET  /server                    server directory state
 *   POST /server                    { action: 'status'|'install'|'check'|'backup'|'generate', ... }
 *   GET  /backups                   server backup list
 *   GET  /history                   recent operation history
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
import {
  DESIGN_KINDS,
  checkDesign,
  deleteEntry,
  ensureDesignScaffold,
  exportDesignWiki,
  getEntry,
  listEntries,
  writeEntry,
} from './design.js'
import { exportFtbQuests, exportKubeJs, exportPatchouli } from './exporters.js'
import { checkPackAgainstServer } from './packcheck.js'
import {
  addMods,
  buildFromProject,
  defaultProject,
  pinMod,
  projectSummary,
  readProject,
  removeMods,
  resolveProject,
  unpinMod,
  writeProject,
} from './project.js'
import { installMrpackToServer, walkFiles } from './mrpack.js'
import { pingServer, resolveMinecraftSrv } from './ping.js'
import { generateServerConfig } from './servercfg.js'
import { createZip } from './zip.js'
import { createProjectRegistry, slugifyProject } from './registry.js'
import { installServerPlugins, marketCategories, marketSearch } from './market.js'
import { applyComposition, composePlan, composeRoles, readComposePlan } from './compose.js'
import { clientProfile, exportClientProfile, updateClientProfile } from './clientprofile.js'

const EXPORT_TARGETS = ['design-wiki', 'ftbquests', 'patchouli', 'kubejs']
const HISTORY_FILE = '.craft-workshop/history.json'
const MAX_HISTORY = 60

function isLoopback(address) {
  const text = String(address ?? '')
  return text === '127.0.0.1' || text === '::1' || text === '::ffff:127.0.0.1' || text === 'localhost' || text === ''
}

async function readJsonBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`JSON 解析失败：${error.message}`))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, value) {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

/**
 * Wire the manager API into the Harness web server.
 * @param {object} ctx plugin context
 * @param {object} config plugin config
 * @param {{ getRoot: () => Promise<string>, outPath: (root: string, value?: string, fallback?: string) => string }} helpers
 */
export function registerWebUi(ctx, config, helpers) {
  const { getRoot, outPath } = helpers

  const registry = createProjectRegistry(config)

  /**
   * The project this request works on. The UI sends `?project=<id>` (empty string means
   * "the session workspace"); without the parameter the registry's active project wins.
   * The API is local and single-user, so one request-scoped field is enough.
   */
  let requestTarget
  const resolveTarget = async (projectRef) => {
    if (projectRef === '') {
      const root = await getRoot()
      return { root, file: outPath(root, config.projectFile), entry: undefined }
    }
    if (projectRef) {
      const entry = await registry.get(projectRef)
      if (!entry) throw new Error(`未注册的项目：${projectRef}`)
      await registry.touch(entry.id)
      return { root: entry.root, file: outPath(entry.root, entry.projectFile || config.projectFile), entry }
    }
    const active = await registry.active()
    if (active) return { root: active.root, file: outPath(active.root, active.projectFile || config.projectFile), entry: active }
    const root = await getRoot()
    return { root, file: outPath(root, config.projectFile), entry: undefined }
  }

  const rootNow = async () => {
    if (requestTarget) return requestTarget.root
    return (await resolveTarget(undefined)).root
  }
  const projectPathNow = async () => {
    if (requestTarget) return requestTarget.file
    return (await resolveTarget(undefined)).file
  }
  const designRootNow = async (project) => resolvePath(await rootNow(), project?.design?.root ?? config.designRoot)
  const serverDirNow = async (project) => outPath(await rootNow(), project?.servers?.mod?.dir ?? 'server/neoforge')
  const buildsDirNow = async (project) => outPath(await rootNow(), project?.pack?.outputDir ?? 'builds')
  const exportBaseNow = async () => resolvePath(await rootNow(), 'build/exports')

  const latestBuild = async (project) => {
    const dir = await buildsDirNow(project)
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      const packs = []
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.mrpack')) continue
        const info = await stat(join(dir, entry.name))
        packs.push({ name: entry.name, path: join(dir, entry.name), size: info.size, modified: info.mtime.toISOString() })
      }
      packs.sort((a, b) => b.modified.localeCompare(a.modified))
      return packs[0]
    } catch {
      return undefined
    }
  }

  // -------------------------------------------------------------------------
  // Operation history
  // -------------------------------------------------------------------------
  const historyPathNow = async () => join(await rootNow(), HISTORY_FILE)
  const readHistory = async () => {
    try {
      return JSON.parse(await readFile(await historyPathNow(), 'utf8'))
    } catch {
      return []
    }
  }
  const recordHistory = async (entry) => {
    const path = await historyPathNow()
    const history = await readHistory()
    history.unshift({ time: new Date().toISOString(), ...entry })
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, `${JSON.stringify(history.slice(0, MAX_HISTORY), null, 2)}\n`, 'utf8')
    return history.slice(0, MAX_HISTORY)
  }

  // -------------------------------------------------------------------------
  // Managers
  // -------------------------------------------------------------------------
  const projectManager = {
    async list() {
      const listing = await registry.list()
      const projects = []
      for (const entry of listing.projects) {
        const exists = await stat(join(entry.root, entry.projectFile || config.projectFile))
          .then(() => true)
          .catch(() => false)
        projects.push({ ...entry, exists })
      }
      return {
        registryFile: listing.file,
        active: listing.active,
        projects,
        workspaceRoot: await getRoot(),
      }
    },
    async create(body) {
      if (!body.name) throw new Error('创建项目需要 name')
      const template = body.template ?? 'modpack'
      const dirArg = body.dir ?? slugifyProject(body.name)
      const dir = dirArg.startsWith('/') ? dirArg : resolvePath(await getRoot(), dirArg)
      const projectFile = resolvePath(dir, config.projectFile)
      if (await stat(projectFile).then(() => true).catch(() => false)) {
        throw new Error(`目录里已有工程文件：${projectFile}（用「注册现有目录」接管）`)
      }
      const project = defaultProject(body.name)
      project.kind = template === 'server' ? 'server' : template === 'empty' ? 'empty' : 'modpack'
      if (body.minecraft) project.target.minecraft = body.minecraft
      if (body.loader) project.target.loader = body.loader
      if (body.loaderVersion) project.target.loaderVersion = body.loaderVersion
      if (Array.isArray(body.mods) && body.mods.length) addMods(project, body.mods.filter(Boolean))
      if (template === 'server') project.servers = { mod: { kind: project.target.loader, dir: 'server' } }
      await mkdir(dir, { recursive: true })
      await writeProject(projectFile, project)
      if (template !== 'empty') await ensureDesignScaffold(resolvePath(dir, project.design?.root ?? config.designRoot))
      await mkdir(resolvePath(dir, project.pack.overrides?.overrides || 'overrides'), { recursive: true })
      await mkdir(resolvePath(dir, project.pack.outputDir || 'builds'), { recursive: true })
      const entry = await registry.register({
        root: dir,
        name: project.name,
        projectFile: config.projectFile,
        kind: project.kind,
        source: 'created',
        activate: body.use !== false,
      })
      await recordHistory({ action: 'project-create', ok: true, detail: `${entry.id} → ${dir}` })
      return { entry, dir, projectFile, template }
    },
    async register(body) {
      const dirArg = body.dir
      if (!dirArg) throw new Error('注册项目需要 dir')
      const dir = dirArg.startsWith('/') ? dirArg : resolvePath(await getRoot(), dirArg)
      const projectFile = resolvePath(dir, config.projectFile)
      let project
      try {
        project = await readProject(projectFile)
      } catch (error) {
        throw new Error(`目录里没有可用的工程文件：${error.message}`)
      }
      const entry = await registry.register({
        root: dir,
        name: body.name ?? project.name,
        projectFile: config.projectFile,
        kind: project.kind ?? 'modpack',
        source: 'registered',
        activate: body.use === true,
      })
      return { entry, dir, projectFile }
    },
    async use(id) {
      return { active: await registry.setActive(id ?? '') }
    },
    async remove(id) {
      if (!id) throw new Error('移除项目需要 project id')
      return registry.remove(id)
    },
    async load() {
      return readProject(await projectPathNow())
    },
    async summary() {
      const project = await this.load()
      return projectSummary(project)
    },
    async readState() {
      const root = await rootNow()
      const projectPath = await projectPathNow()
      let project
      try {
        project = await readProject(projectPath)
      } catch {
        project = undefined
      }
      const designRoot = await designRootNow(project)
      let design = { total: 0, totals: {}, errors: [], warnings: [], ok: true }
      try {
        const report = await checkDesign(designRoot)
        design = {
          total: report.total,
          totals: report.stats,
          errors: report.errors.slice(0, 12),
          warnings: report.warnings.slice(0, 12),
          ok: report.ok,
          info: report.info,
        }
      } catch (error) {
        design = { total: 0, totals: {}, errors: [error.message], warnings: [], ok: false }
      }
      const buildsDir = await buildsDirNow(project)
      const builds = []
      try {
        for (const entry of await readdir(buildsDir, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.mrpack')) continue
          const info = await stat(join(buildsDir, entry.name))
          builds.push({ name: entry.name, size: info.size, modified: info.mtime.toISOString() })
        }
        builds.sort((a, b) => b.modified.localeCompare(a.modified))
      } catch {
        /* no builds */
      }
      const exportsInfo = {}
      for (const target of EXPORT_TARGETS) {
        try {
          const files = await walkFiles(resolvePath(await rootNow(), 'build/exports', target))
          exportsInfo[target] = { present: files.length > 0, files: files.length }
        } catch {
          exportsInfo[target] = { present: false, files: 0 }
        }
      }
      let serverMods = null
      const serverDir = await serverDirNow(project)
      try {
        serverMods = (await readdir(join(serverDir, 'mods'))).filter((name) => name.endsWith('.jar')).length
      } catch {
        serverMods = null
      }
      const history = await readHistory()
      return {
        ok: true,
        generatedAt: new Date().toISOString(),
        workspaceRoot: root,
        projectFile: projectPath,
        hasProject: Boolean(project),
        project: project ? projectSummary(project) : null,
        modsDetailed: project ? project.pack.mods : [],
        design,
        builds: builds.slice(0, 8),
        buildsTotal: builds.length,
        exports: exportsInfo,
        serverMods,
        serverDir,
        history: history.slice(0, 12),
      }
    },
    async update(patch) {
      const project = await this.load()
      if (patch.name) project.name = String(patch.name)
      if (patch.versionId) project.pack.versionId = String(patch.versionId)
      if (patch.minecraft) project.target.minecraft = String(patch.minecraft)
      if (patch.loader) project.target.loader = String(patch.loader)
      await writeProject(await projectPathNow(), project)
      return projectSummary(project)
    },
  }

  const modManager = {
    async list(resolve) {
      const project = await projectManager.load()
      if (!resolve) return { mods: project.pack.mods, warnings: [] }
      const plan = await resolveProject(config, project, AbortSignal.timeout(60000))
      return {
        mods: project.pack.mods,
        warnings: plan.warnings,
        plan: plan.entries.map((entry) => ({
          id: entry.slug,
          title: entry.title,
          version: entry.versionNumber,
          clientSide: entry.clientSide,
          serverSide: entry.serverSide,
          filename: entry.filename,
          direct: entry.direct,
        })),
      }
    },
    async run(body) {
      const file = await projectPathNow()
      const project = await readProject(file)
      const refs = Array.isArray(body.refs) ? body.refs.filter(Boolean) : []
      const action = body.action
      if (!['add', 'remove', 'pin', 'unpin'].includes(action)) throw new Error(`未知的模组操作：${action}`)
      if (!refs.length) throw new Error('缺少 refs')
      let changed = []
      if (action === 'add') changed = addMods(project, refs)
      else if (action === 'remove') changed = removeMods(project, refs)
      else if (action === 'pin') changed = [pinMod(project, refs[0], body.versionId)]
      else changed = unpinMod(project, refs)
      await writeProject(file, project)
      return { action, changed: changed.map((mod) => mod.id ?? mod), mods: project.pack.mods }
    },
  }

  const designManager = {
    async list(kind) {
      return listEntries(await designRootNow(await projectManager.load().catch(() => undefined)), kind)
    },
    async get(kind, id) {
      return getEntry(await designRootNow(await projectManager.load().catch(() => undefined)), kind, id)
    },
    async run(body) {
      const root = await designRootNow(await projectManager.load().catch(() => undefined))
      if (body.action === 'write') {
        if (!body.kind || !body.id || !body.data) throw new Error('write 需要 kind/id/data')
        const result = await writeEntry(root, body.kind, body.id, body.data, { replace: Boolean(body.replace) })
        let relevant = []
        try {
          const report = await checkDesign(root)
          relevant = [...report.errors, ...report.warnings].filter((message) => message.includes(`[${body.kind}/${body.id}]`))
        } catch {
          /* best effort */
        }
        return { path: result.path, created: result.created, validation: result.validation, relevant }
      }
      if (body.action === 'delete') {
        if (!body.kind || !body.id) throw new Error('delete 需要 kind/id')
        return deleteEntry(root, body.kind, body.id)
      }
      if (body.action === 'check') {
        return checkDesign(root)
      }
      throw new Error(`未知的设计操作：${body.action}`)
    },
    async schema(kind) {
      if (kind) return DESIGN_KINDS[kind] ?? null
      return DESIGN_KINDS
    },
  }

  const exportManager = {
    async run(target) {
      const root = await rootNow()
      const project = await projectManager.load().catch(() => undefined)
      const designRoot = await designRootNow(project)
      const exportBase = await exportBaseNow()
      const namespace = project?.id ?? config.defaultNamespace
      const language = 'zh_cn'
      const targets = target === 'all' ? EXPORT_TARGETS : [target]
      const results = []
      for (const item of targets) {
        try {
          let result
          if (item === 'design-wiki') result = await exportDesignWiki(designRoot, resolvePath(exportBase, 'design-wiki'))
          else if (item === 'ftbquests') result = await exportFtbQuests({ config, project, designRoot, projectRoot: root, outDir: resolvePath(exportBase, 'ftbquests'), namespace, language })
          else if (item === 'patchouli') result = await exportPatchouli({ config, project, designRoot, projectRoot: root, outDir: resolvePath(exportBase, 'patchouli'), namespace, language })
          else if (item === 'kubejs') result = await exportKubeJs({ config, project, designRoot, projectRoot: root, outDir: resolvePath(exportBase, 'kubejs'), namespace, language })
          results.push({ target: item, ok: true, outDir: result.outDir, summary: result.summary, warnings: result.warnings ?? [] })
        } catch (error) {
          results.push({ target: item, ok: false, error: error.message })
        }
      }
      await recordHistory({
        action: 'export',
        target,
        ok: results.every((result) => result.ok),
        detail: results.map((result) => `${result.target}:${result.ok ? 'ok' : 'failed'}`).join(', '),
      })
      return results
    },
  }

  const buildManager = {
    async run(body) {
      const root = await rootNow()
      const file = await projectPathNow()
      const result = await buildFromProject(
        config,
        { projectRoot: root, projectPath: file, versionId: body.versionId, includeOptional: Boolean(body.includeOptional) },
        AbortSignal.timeout(180000),
      )
      await recordHistory({
        action: 'build',
        ok: true,
        detail: `${result.outputPath} · ${result.files} mods · ${result.contentFiles ?? 0} content files`,
      })
      return {
        outputPath: result.outputPath,
        size: result.size,
        sha1: result.sha1,
        files: result.files,
        overrides: result.overrides,
        contentFiles: result.contentFiles,
        dependencies: result.dependencies,
        warnings: result.warnings,
        contentWarnings: result.contentWarnings,
      }
    },
    async list() {
      const project = await projectManager.load().catch(() => undefined)
      const dir = await buildsDirNow(project)
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        const packs = []
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.mrpack')) continue
          const info = await stat(join(dir, entry.name))
          packs.push({ name: entry.name, path: join(dir, entry.name), size: info.size, modified: info.mtime.toISOString() })
        }
        packs.sort((a, b) => b.modified.localeCompare(a.modified))
        return packs
      } catch {
        return []
      }
    },
  }

  const serverManager = {
    async state() {
      const project = await projectManager.load().catch(() => undefined)
      const dir = await serverDirNow(project)
      const latest = await latestBuild(project)
      let modsCount = null
      try {
        modsCount = (await readdir(join(dir, 'mods'))).filter((name) => name.endsWith('.jar')).length
      } catch {
        modsCount = null
      }
      let check = null
      let checkError
      if (latest) {
        try {
          check = await checkPackAgainstServer(latest.path, dir)
        } catch (error) {
          checkError = error.message
        }
      }
      return {
        dir,
        exists: await stat(dir).then((info) => info.isDirectory()).catch(() => false),
        modsCount,
        latestBuild: latest ? { name: latest.name, size: latest.size, modified: latest.modified } : null,
        check,
        checkError,
        statusTarget: {
          host: project?.operations?.statusHost ?? '',
          port: project?.operations?.statusPort ?? 25565,
        },
      }
    },
    async status(host, port) {
      const targetHost = String(host || '').trim()
      if (!targetHost) throw new Error('缺少服务器地址')
      let srv
      let targetPort = port
      if (targetPort === undefined || targetPort === null || targetPort === '') {
        srv = await resolveMinecraftSrv(targetHost)
        targetPort = srv?.port ?? 25565
      }
      const status = await pingServer({ host: srv?.host ?? targetHost, port: targetPort, timeoutMs: 8000 })
      await recordHistory({ action: 'server-status', ok: true, detail: `${targetHost}:${targetPort} ${status.playersOnline}/${status.playersMax}` })
      return { ...status, targetHost: srv?.host ?? targetHost, port: targetPort, srv }
    },
    async install() {
      const project = await projectManager.load()
      const latest = await latestBuild(project)
      if (!latest) throw new Error('还没有构建产物，请先构建整合包')
      const dir = await serverDirNow(project)
      const result = await installMrpackToServer(config, { packPath: latest.path, serverDir: dir }, AbortSignal.timeout(300000))
      await recordHistory({ action: 'server-install', ok: result.failed.length === 0, detail: `${latest.name} → ${dir}（${result.downloaded.length} 个文件）` })
      return { build: latest.name, ...result }
    },
    async check() {
      const project = await projectManager.load()
      const latest = await latestBuild(project)
      if (!latest) throw new Error('还没有构建产物，请先构建整合包')
      const dir = await serverDirNow(project)
      const result = await checkPackAgainstServer(latest.path, dir)
      await recordHistory({ action: 'server-check', ok: result.ok, detail: `${latest.name} vs ${dir}` })
      return { build: latest.name, ...result }
    },
    async backup() {
      const project = await projectManager.load().catch(() => undefined)
      const dir = await serverDirNow(project)
      const root = await rootNow()
      const backupDir = resolvePath(root, 'build/backups')
      await mkdir(backupDir, { recursive: true })
      const candidates = ['world', 'world_nether', 'world_the_end', 'config', 'plugins', 'mods', 'server.properties', 'eula.txt', 'ops.json', 'whitelist.json', 'banned-players.json', 'banned-ips.json']
      const files = []
      for (const relative of candidates) {
        try {
          const filesFound = await walkFiles(join(dir, relative))
          for (const file of filesFound) files.push({ name: `${relative}/${file.relativePath}`, absolutePath: file.absolutePath })
        } catch {
          try {
            const info = await stat(join(dir, relative))
            if (info.isFile()) files.push({ name: relative, absolutePath: join(dir, relative) })
          } catch {
            /* skip missing entry */
          }
        }
      }
      if (!files.length) throw new Error('没有找到可备份的服务端文件（先运行 mc_server_config / 部署服务端）')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const name = `server-backup-${stamp}.zip`
      const buffers = []
      for (const file of files) buffers.push({ name: file.name, data: await readFile(file.absolutePath) })
      const zip = createZip(buffers)
      await writeFile(join(backupDir, name), zip)
      await recordHistory({ action: 'server-backup', ok: true, detail: `${name} · ${files.length} 个文件 · ${zip.length} 字节` })
      return { name, path: join(backupDir, name), files: files.length, size: zip.length }
    },
    async backups() {
      const root = await rootNow()
      const dir = resolvePath(root, 'build/backups')
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        const backups = []
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.zip')) continue
          const info = await stat(join(dir, entry.name))
          backups.push({ name: entry.name, size: info.size, modified: info.mtime.toISOString() })
        }
        backups.sort((a, b) => b.modified.localeCompare(a.modified))
        return backups
      } catch {
        return []
      }
    },
    async generate(body) {
      const project = await projectManager.load()
      const dir = await serverDirNow(project)
      const kind = body.kind ?? (project.target.loader === 'fabric' ? 'fabric' : 'neoforge')
      const result = await generateServerConfig(
        config,
        {
          kind,
          dir,
          gameVersion: project.target.minecraft,
          loaderVersion: project.target.loaderVersion || undefined,
          overwrite: Boolean(body.overwrite),
          downloadJar: Boolean(body.downloadJar),
          settings: { motd: project.operations?.motd ?? `${project.name} 服务器`, maxPlayers: project.operations?.maxPlayers ?? 30 },
        },
        AbortSignal.timeout(180000),
      )
      await recordHistory({ action: 'server-config', ok: true, detail: `${kind} → ${dir}（${result.files.length} 个文件）` })
      return { dir: result.dir, kind: result.kind, files: result.files, notes: result.notes }
    },
  }

  const marketManager = {
    async search(params, target) {
      const project = await readProject(target.file).catch(() => undefined)
      const loaders = params.loaders?.length ? params.loaders : project ? [project.target.loader] : [config.defaultLoader]
      const gameVersions = params.gameVersions?.length ? params.gameVersions : project ? [project.target.minecraft] : [config.defaultGameVersion]
      const result = await marketSearch(config, {
        category: params.category,
        query: params.query ?? '',
        projectType: params.type,
        loaders,
        gameVersions,
        side: params.side,
        sortBy: params.sort,
        limit: Number(params.limit) || 12,
      }, AbortSignal.timeout(60000))
      return { ...result, categories: marketCategories(), loaders, gameVersions }
    },
    async install(target, body) {
      const project = await readProject(target.file)
      const refs = (body.refs ?? []).filter(Boolean)
      if (!refs.length) throw new Error('缺少 refs')
      if (body.action === 'install-plugins') {
        const serverDir = resolvePath(target.root, project.servers?.mod?.dir ?? 'server/neoforge')
        const result = await installServerPlugins(config, {
          refs,
          serverDir,
          gameVersion: project.target.minecraft,
          loaders: body.loaders?.length ? body.loaders : ['paper'],
          overwrite: Boolean(body.overwrite),
        }, AbortSignal.timeout(180000))
        project.servers = project.servers ?? {}
        project.servers.mod = project.servers.mod ?? { kind: project.target.loader, dir: 'server/neoforge' }
        const list = new Set(project.servers.mod.plugins ?? [])
        for (const item of result.installed) list.add(item.ref)
        project.servers.mod.plugins = [...list]
        await writeProject(target.file, project)
        await recordHistory({ action: 'market-install-plugins', ok: result.failed.length === 0, detail: refs.join(', ') })
        return result
      }
      const added = addMods(project, refs)
      await writeProject(target.file, project)
      await recordHistory({ action: 'market-install-mods', ok: true, detail: refs.join(', ') })
      return { added: added.map((mod) => mod.id), mods: project.pack.mods }
    },
  }

  const composeManager = {
    roles() {
      return { roles: composeRoles() }
    },
    async plan(target, body) {
      const project = await readProject(target.file)
      const planDir = resolvePath(target.root, 'build/exports/compose')
      const { plan, path } = await composePlan(config, {
        project,
        roles: body.roles?.length ? body.roles : composeRoles().map((role) => role.id),
        perRole: body.perRole,
        theme: body.theme ?? '',
        avoid: body.avoid ?? [],
        must: body.must ?? [],
        planDir,
      }, AbortSignal.timeout(180000))
      await recordHistory({ action: 'compose-plan', ok: true, detail: `${plan.id} · ${plan.entries.length} 项` })
      return { plan, path }
    },
    async apply(target, body) {
      const project = await readProject(target.file)
      const planDir = resolvePath(target.root, 'build/exports/compose')
      let plan
      let refs = body.refs ?? []
      if (body.plan) {
        const loaded = await readComposePlan(planDir, body.plan)
        plan = loaded.plan
        refs = plan.entries.map((entry) => entry.slug)
      }
      if (!refs.length) throw new Error('需要 plan 或 refs')
      const { added } = applyComposition(project, { plan, refs })
      await writeProject(target.file, project)
      await recordHistory({ action: 'compose-apply', ok: true, detail: `${added.length} 项` })
      return { added: added.map((mod) => mod.id), mods: project.pack.mods, plan: plan?.id ?? '' }
    },
  }

  const clientManager = {
    async show(target) {
      const project = await readProject(target.file)
      return { profile: clientProfile(project), raw: project.client ?? {} }
    },
    async set(target, patch) {
      const project = await readProject(target.file)
      const profile = updateClientProfile(project, patch)
      await writeProject(target.file, project)
      return { profile }
    },
    async mods(target, action, refs) {
      const project = await readProject(target.file)
      const profile = clientProfile(project)
      const set = new Set(profile.mods)
      for (const ref of refs ?? []) {
        if (action === 'add-mods') set.add(ref)
        else set.delete(ref)
      }
      updateClientProfile(project, { mods: [...set] })
      await writeProject(target.file, project)
      return { mods: [...set] }
    },
    async export(target) {
      const project = await readProject(target.file)
      const exportDir = resolvePath(target.root, 'build/exports/client')
      const launcherDir = resolvePath(target.root, 'build/client')
      const result = await exportClientProfile(project, { exportDir, launcherDir })
      const content = project.pack.content ?? []
      if (!content.some((mapping) => mapping.from === 'build/exports/client')) {
        content.push({ from: 'build/exports/client', to: '', zone: 'overrides', optional: true })
        project.pack.content = content
        await writeProject(target.file, project)
      }
      await recordHistory({ action: 'client-export', ok: true, detail: exportDir })
      return { exportDir, launcherDir, optionCount: result.optionCount }
    },
  }

  // -------------------------------------------------------------------------
  // Route dispatch
  // -------------------------------------------------------------------------
  const dispatch = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/^\/craft-workshop\/api/, '') || '/'
    const method = req.method ?? 'GET'
    const projectParam = url.searchParams.has('project') ? url.searchParams.get('project') : undefined
    try {
      requestTarget = await resolveTarget(projectParam)
    } catch (error) {
      requestTarget = undefined
      return sendJson(res, 404, { ok: false, error: error.message })
    }
    const wantsWrite = method === 'POST' || method === 'DELETE'
    if (wantsWrite && !isLoopback(req.socket?.remoteAddress)) {
      return sendJson(res, 403, { ok: false, error: '只允许本机访问' })
    }
    let body = {}
    if (wantsWrite) {
      try {
        body = await readJsonBody(req)
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message })
      }
    }
    try {
      if (method === 'GET' && path === '/projects') return sendJson(res, 200, { ok: true, ...(await projectManager.list()) })
      if (method === 'POST' && path === '/projects') {
        const action = body.action
        if (action === 'create') return sendJson(res, 200, { ok: true, ...(await projectManager.create(body)) })
        if (action === 'register') return sendJson(res, 200, { ok: true, ...(await projectManager.register(body)) })
        if (action === 'use') return sendJson(res, 200, { ok: true, ...(await projectManager.use(body.project)) })
        if (action === 'remove') return sendJson(res, 200, { ok: true, ...(await projectManager.remove(body.project)) })
        return sendJson(res, 400, { ok: false, error: `未知的项目操作：${action}` })
      }
      if (method === 'GET' && path === '/state') {
        const state = await projectManager.readState()
        return sendJson(res, 200, {
          ok: true,
          ...state,
          target: {
            root: requestTarget?.root ?? state.workspaceRoot,
            id: requestTarget?.entry?.id ?? '',
            name: requestTarget?.entry?.name ?? '',
            kind: requestTarget?.entry?.kind ?? '',
          },
        })
      }
      if (method === 'GET' && path === '/history') return sendJson(res, 200, { ok: true, history: await readHistory() })
      if (method === 'GET' && path === '/mods') {
        return sendJson(res, 200, { ok: true, ...(await modManager.list(url.searchParams.get('resolve') === '1')) })
      }
      if (method === 'POST' && path === '/mods') return sendJson(res, 200, { ok: true, ...(await modManager.run(body)) })
      if (method === 'GET' && path === '/design') {
        const kind = url.searchParams.get('kind')
        const id = url.searchParams.get('id')
        if (!kind) return sendJson(res, 200, { ok: true, kinds: DESIGN_KINDS })
        if (id) return sendJson(res, 200, { ok: true, entry: await designManager.get(kind, id) })
        return sendJson(res, 200, { ok: true, ...(await designManager.list(kind)) })
      }
      if (method === 'POST' && path === '/design') return sendJson(res, 200, { ok: true, ...(await designManager.run(body)) })
      if (method === 'POST' && path === '/export') {
        return sendJson(res, 200, { ok: true, results: await exportManager.run(body.target ?? 'all') })
      }
      if (method === 'POST' && path === '/build') return sendJson(res, 200, { ok: true, ...(await buildManager.run(body)) })
      if (method === 'GET' && path === '/builds') return sendJson(res, 200, { ok: true, builds: await buildManager.list() })
      if (method === 'GET' && path === '/market') {
        return sendJson(res, 200, {
          ok: true,
          ...(await marketManager.search(
            {
              category: url.searchParams.get('category') ?? undefined,
              query: url.searchParams.get('query') ?? '',
              type: url.searchParams.get('type') ?? undefined,
              side: url.searchParams.get('side') ?? undefined,
              sort: url.searchParams.get('sort') ?? undefined,
              limit: url.searchParams.get('limit') ?? undefined,
            },
            requestTarget ?? (await resolveTarget(undefined)),
          )),
        })
      }
      if (method === 'POST' && path === '/market') {
        const target = requestTarget ?? (await resolveTarget(undefined))
        return sendJson(res, 200, { ok: true, ...(await marketManager.install(target, body)) })
      }
      if (method === 'GET' && path === '/compose') return sendJson(res, 200, { ok: true, ...composeManager.roles() })
      if (method === 'POST' && path === '/compose') {
        const target = requestTarget ?? (await resolveTarget(undefined))
        if (body.action === 'plan') return sendJson(res, 200, { ok: true, ...(await composeManager.plan(target, body)) })
        if (body.action === 'apply') return sendJson(res, 200, { ok: true, ...(await composeManager.apply(target, body)) })
        return sendJson(res, 400, { ok: false, error: `未知的组合操作：${body.action}` })
      }
      if (method === 'GET' && path === '/client') {
        const target = requestTarget ?? (await resolveTarget(undefined))
        return sendJson(res, 200, { ok: true, ...(await clientManager.show(target)) })
      }
      if (method === 'POST' && path === '/client') {
        const target = requestTarget ?? (await resolveTarget(undefined))
        if (body.action === 'set') return sendJson(res, 200, { ok: true, ...(await clientManager.set(target, body.patch ?? {})) })
        if (body.action === 'add-mods' || body.action === 'remove-mods') {
          return sendJson(res, 200, { ok: true, ...(await clientManager.mods(target, body.action, body.refs ?? [])) })
        }
        if (body.action === 'export') return sendJson(res, 200, { ok: true, ...(await clientManager.export(target)) })
        return sendJson(res, 400, { ok: false, error: `未知的客户端操作：${body.action}` })
      }
      if (method === 'GET' && path === '/server') return sendJson(res, 200, { ok: true, ...(await serverManager.state()) })
      if (method === 'GET' && path === '/backups') return sendJson(res, 200, { ok: true, backups: await serverManager.backups() })
      if (method === 'POST' && path === '/server') {
        const action = body.action
        if (action === 'status') return sendJson(res, 200, { ok: true, status: await serverManager.status(body.host, body.port) })
        if (action === 'install') return sendJson(res, 200, { ok: true, result: await serverManager.install() })
        if (action === 'check') return sendJson(res, 200, { ok: true, result: await serverManager.check() })
        if (action === 'backup') return sendJson(res, 200, { ok: true, result: await serverManager.backup() })
        if (action === 'generate') return sendJson(res, 200, { ok: true, result: await serverManager.generate(body) })
        return sendJson(res, 400, { ok: false, error: `未知的服务器操作：${action}` })
      }
      return sendJson(res, 404, { ok: false, error: `未知接口：${method} ${path}` })
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error.message })
    }
  }

  let disposer
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (child) => {
      child.effect(() => {
        disposer = child.webServer.register({ kind: 'prefix', path: '/craft-workshop/api', handler: dispatch })
        return disposer
      })
    })
  } else {
    const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (webServer) disposer = webServer.register({ kind: 'prefix', path: '/craft-workshop/api', handler: dispatch })
  }
  return () => disposer?.()
}
