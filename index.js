/**
 * CraftWorkshop（方块工坊）— IPTHMC 社团的 Minecraft 运营 Host 插件。
 *
 * Registers model-facing tools for:
 *  - Modrinth resource search / project & version inspection
 *  - dependency resolution for a target Minecraft version + loader
 *  - .mrpack modpack generation
 *  - NeoForge / Fabric / Paper / Velocity / Arclight server configuration generation
 *  - Java server status ping (Server List Ping)
 *  - modpack ↔ server mod directory consistency checks
 */
import { mkdir, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import { formatBytes, formatDate, formatTable, truncate } from './src/util.js'
import {
  dependencySummary,
  getProject,
  getProjectVersions,
  getVersion,
  resolvePlan,
  searchProjects,
} from './src/modrinth.js'
import { LOADER_KINDS, loaderInfo } from './src/loaders.js'
import { buildMrpack, installMrpackToServer } from './src/mrpack.js'
import { checkPackAgainstServer } from './src/packcheck.js'
import { SERVER_KINDS, generateServerConfig } from './src/servercfg.js'
import { pingServer, resolveMinecraftSrv } from './src/ping.js'
import {
  DESIGN_KINDS,
  DESIGN_KIND_NAMES,
  checkDesign,
  deleteEntry,
  ensureDesignScaffold,
  exportDesignWiki,
  getEntry,
  listEntries,
  writeEntry,
} from './src/design.js'
import { exportFtbQuests, exportKubeJs, exportPatchouli } from './src/exporters.js'
import { registerWebUi } from './src/webui.js'
import { createProjectRegistry, slugifyProject } from './src/registry.js'
import { MARKET_CATEGORIES, installServerPlugins, marketCategories, marketSearch } from './src/market.js'
import { applyComposition, composePlan, composeRoles, readComposePlan, renderPlanTable } from './src/compose.js'
import { CLIENT_DEFAULTS, clientProfile, exportClientProfile, updateClientProfile } from './src/clientprofile.js'
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
} from './src/project.js'

export const inject = ['tools']

const DEFAULTS = {
  userAgent: 'craft-workshop/0.7.0 (https://ipthmc.zyghit.cn)',
  defaultGameVersion: '1.21.1',
  defaultLoader: 'neoforge',
  defaultOutputRoot: '',
  cacheTtlSeconds: 600,
  requestTimeoutMs: 20000,
  maxDependencyDepth: 6,
  curseForgeApiKey: '',
  projectFile: 'project.json',
  designRoot: 'design',
  defaultNamespace: 'ipthmc',
  registryFile: '',
}

const PROJECT_TYPES = ['mod', 'plugin', 'modpack', 'resourcepack', 'shader', 'datapack']
const SORT_INDEXES = ['relevance', 'downloads', 'follows', 'newest', 'updated']
const LOADER_ENUM = [...new Set([...LOADER_KINDS.slice(1), 'forge', 'quilt', 'paper', 'purpur', 'velocity', 'folia', 'waterfall', 'bungeecord', 'spigot', 'bukkit'])]

function fillDefaults(config) {
  const merged = { ...DEFAULTS }
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value !== undefined) merged[key] = value
  }
  return merged
}

function slugify(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'ipthmc-pack'
}

function sideText(entry) {
  const client = entry.clientSide ?? '?'
  const server = entry.serverSide ?? '?'
  return `${client}/${server}`
}

function textBlocks(text) {
  return [{ type: 'text', text }]
}

/** Canonical tool values must be lossless JSON: drop undefined/function fields and normalize specials. */
function toLosslessJson(value) {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value))
}

function defineTool(definition) {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (args, value) => textBlocks(definition.render(args, value)),
    },
    execute: async (args, exec) => toLosslessJson(await definition.execute(args, exec)),
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} rawConfig plugin row config
 */
export function apply(ctx, rawConfig) {
  const config = fillDefaults(rawConfig)

  /**
   * Resolve the calling session's effective working directory. Global tools run for
   * every agent, so the directory must come from the agent of the current call rather
   * than from the Host process cwd.
   */
  let lastWorkspaceRoot = ''
  const sessionRoot = async (exec) => {
    if (config.defaultOutputRoot) {
      lastWorkspaceRoot = String(config.defaultOutputRoot)
      return lastWorkspaceRoot
    }
    try {
      const workingDirectory = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined
      if (workingDirectory?.ensure && exec?.agent) {
        lastWorkspaceRoot = await workingDirectory.ensure(exec.agent, exec.signal)
        return lastWorkspaceRoot
      }
      if (workingDirectory?.defaultDirectory) {
        lastWorkspaceRoot = workingDirectory.defaultDirectory
        return lastWorkspaceRoot
      }
    } catch {
      /* fall through to process cwd */
    }
    lastWorkspaceRoot = process.cwd()
    return lastWorkspaceRoot
  }

  const outPath = (root, value, fallback) => {
    const raw = String(value ?? fallback ?? '').trim()
    if (!raw) throw new Error('缺少输出路径（output / dir）')
    return isAbsolute(raw) ? raw : resolvePath(root, raw)
  }

  const registry = createProjectRegistry(config)

  /**
   * Resolve which project a call works on: an explicit registry id wins, otherwise the
   * session workspace is used (so an agent keeps working where it was started).
   */
  const targetFor = async (exec, projectRef, pathArg) => {
    if (projectRef) {
      const entry = await registry.get(projectRef)
      if (!entry) {
        throw new Error(`未注册的项目 "${projectRef}"：先 mc_project action=list 查看，或用 action=register 注册目录`)
      }
      await registry.touch(entry.id)
      return {
        root: entry.root,
        file: outPath(entry.root, pathArg ?? entry.projectFile ?? config.projectFile),
        entry,
      }
    }
    const root = await sessionRoot(exec)
    return { root, file: outPath(root, pathArg ?? config.projectFile), entry: undefined }
  }

  /** Absolute path of the project file for one call. */
  const projectFileFor = async (exec, pathArg, projectRef) => {
    const target = await targetFor(exec, projectRef, pathArg)
    return { root: target.root, file: target.file, entry: target.entry }
  }

  /** Absolute design root: explicit override > project.json design.root > plugin config. */
  const designRootFor = async (root, projectFile, override) => {
    if (override) return outPath(root, override)
    try {
      const project = await readProject(projectFile)
      return resolvePath(root, project.design?.root ?? config.designRoot)
    } catch {
      return resolvePath(root, config.designRoot)
    }
  }

  const projectPaths = async (exec, pathArg, projectRef) => {
    const { root, file, entry } = await projectFileFor(exec, pathArg, projectRef)
    return { root, file, entry, designRoot: await designRootFor(root, file) }
  }

  // ---------------------------------------------------------------------------
  // mc_search
  // ---------------------------------------------------------------------------
  const searchTool = defineTool({
    name: 'mc_search',
    description:
      '搜索 Modrinth 资源（自动带 Minecraft 版本/加载器过滤）。默认使用插件配置的目标版本（' +
      `${config.defaultGameVersion}/${config.defaultLoader}）。` +
      '返回 slug、下载量、更新日期、客户端/服务端支持与简介；slug 可直接用于 mc_project、mc_resolve、mc_pack。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词；留空则按下载量浏览热门资源' },
        projectType: { type: 'string', enum: PROJECT_TYPES, description: '资源类型，默认 mod' },
        loaders: {
          type: 'array',
          items: { type: 'string', enum: LOADER_ENUM },
          description: '加载器过滤，如 ["neoforge"]；mod/modpack 默认使用插件配置的加载器',
        },
        gameVersions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Minecraft 版本过滤，如 ["1.21.1"]；默认使用插件配置的目标版本',
        },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '每页条数，默认 10' },
        offset: { type: 'integer', minimum: 0, description: '分页偏移，默认 0' },
        sortBy: { type: 'string', enum: SORT_INDEXES, description: '排序：relevance/downloads/follows/newest/updated，默认 relevance' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const projectType = args.projectType ?? 'mod'
      const useDefaultLoader = projectType === 'mod' || projectType === 'modpack'
      const loaders = args.loaders?.length
        ? args.loaders
        : useDefaultLoader && config.defaultLoader
          ? [config.defaultLoader]
          : []
      const gameVersions = args.gameVersions?.length ? args.gameVersions : [config.defaultGameVersion]
      const limit = args.limit ?? 10
      const offset = args.offset ?? 0
      const result = await searchProjects(
        config,
        {
          query: args.query ?? '',
          projectType,
          loaders,
          gameVersions,
          limit,
          offset,
          index: args.sortBy ?? 'relevance',
        },
        exec.signal,
      )
      const rows = result.hits.map((hit) => [
        hit.slug,
        truncate(hit.title, 26),
        hit.downloads,
        formatDate(hit.updated),
        sideText(hit),
        truncate(hit.description, 46),
      ])
      const lines = [
        `Modrinth 搜索：${args.query ? `「${args.query}」` : '（热门浏览）'} | 类型 ${projectType} | 版本 ${gameVersions.join(',') || '不限'} | 加载器 ${loaders.join(',') || '不限'}`,
        `共命中 ${result.totalHits} 个，本次显示 ${offset + 1}-${offset + rows.length} 条`,
        '',
        formatTable(['slug', '标题', '下载', '更新', '客户端/服务端', '简介'], rows),
        '',
        '下一步：mc_resource 查看详情；mc_resolve 解析依赖；mc_build 从工程构建整合包。',
      ]
      return {
        tool: 'mc_search',
        query: args.query ?? '',
        projectType,
        loaders,
        gameVersions,
        totalHits: result.totalHits,
        hits: result.hits,
        text: lines.join('\n'),
      }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_project
  // ---------------------------------------------------------------------------
  const resourceTool = defineTool({
    name: 'mc_resource',
    description:
      '查看一个 Modrinth 资源项目的详情与兼容版本列表（按 Minecraft 版本 + 加载器过滤），' +
      '包含下载直链、sha1/sha512、依赖列表与客户端/服务端支持情况。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '项目 slug 或 project id，例如 "sodium"' },
        gameVersions: { type: 'array', items: { type: 'string' }, description: 'Minecraft 版本过滤，默认使用插件目标版本' },
        loaders: { type: 'array', items: { type: 'string', enum: LOADER_ENUM }, description: '加载器过滤，默认使用插件目标加载器' },
        versionLimit: { type: 'integer', minimum: 1, maximum: 50, description: '最多显示多少个版本，默认 10' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const project = await getProject(config, args.id, exec.signal)
      const gameVersions = args.gameVersions?.length ? args.gameVersions : [config.defaultGameVersion]
      const loaders = args.loaders?.length ? args.loaders : [config.defaultLoader]
      const versionLimit = args.versionLimit ?? 10
      let versions = await getProjectVersions(config, project.id, { gameVersions, loaders }, exec.signal)
      let filterNote = `筛选：Minecraft ${gameVersions.join(',')} / ${loaders.join(',')}`
      if (!versions.length) {
        versions = await getProjectVersions(config, project.id, {}, exec.signal)
        filterNote = '没有匹配当前版本/加载器的版本，以下显示该项目的全部版本'
      }
      const shown = versions.slice(0, versionLimit)
      const rows = shown.map((version) => {
        const file = (version.files ?? []).find((item) => item.primary) ?? version.files?.[0]
        return [
          truncate(version.version_number, 20),
          version.version_type,
          formatDate(version.date_published),
          file?.filename ?? '?',
          formatBytes(file?.size),
          dependencySummary(version),
        ]
      })
      const latest = versions[0]
      const latestFile = (latest?.files ?? []).find((item) => item.primary) ?? latest?.files?.[0]
      const lines = [
        `项目：${project.title}（${project.slug}）  id: ${project.id}`,
        `类型：${project.project_type} | 客户端：${project.client_side} | 服务端：${project.server_side} | 下载：${project.downloads} | 更新：${formatDate(project.updated)}`,
        `简介：${truncate(project.description, 300)}`,
        latestFile ? `最新版本文件：${latestFile.filename}（${formatBytes(latestFile.size)}）` : '',
        latestFile ? `下载直链：${latestFile.url}` : '',
        '',
        `${filterNote}，共 ${versions.length} 个版本，显示 ${shown.length} 个：`,
        formatTable(['版本号', '类型', '发布日期', '文件名', '大小', '依赖'], rows),
        '',
        latestFile ? `注意：版本对象里 sha1=${latestFile.hashes?.sha1 ?? '?'}，sha512=${latestFile.hashes?.sha512?.slice(0, 16) ?? '?'}…` : '',
      ].filter(Boolean)
      return {
        tool: 'mc_project',
        project: {
          id: project.id,
          slug: project.slug,
          title: project.title,
          projectType: project.project_type,
          clientSide: project.client_side,
          serverSide: project.server_side,
          downloads: project.downloads,
          updated: project.updated,
        },
        versions: shown.map((version) => ({
          versionId: version.id,
          versionNumber: version.version_number,
          versionType: version.version_type,
          gameVersions: version.game_versions,
          loaders: version.loaders,
          datePublished: version.date_published,
          filename: ((version.files ?? []).find((file) => file.primary) ?? version.files?.[0])?.filename,
          url: ((version.files ?? []).find((file) => file.primary) ?? version.files?.[0])?.url,
          dependencies: version.dependencies,
        })),
        text: lines.join('\n'),
      }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_resolve
  // ---------------------------------------------------------------------------
  const resolveTool = defineTool({
    name: 'mc_resolve',
    description:
      '解析一组 Modrinth 项目的完整依赖树（只跟随 required 依赖，可选包含 optional），' +
      '自动挑选匹配目标 Minecraft 版本 + 加载器的最新稳定版本，输出可安装清单与冲突/缺失警告。' +
      '项目引用格式：slug、projectId、slug@versionId。',
    parameters: {
      type: 'object',
      properties: {
        projects: {
          type: 'array',
          items: { type: 'string' },
          description: '项目引用列表，例如 ["sodium","lithium","create@VERSION_ID"]',
        },
        gameVersion: { type: 'string', description: '目标 Minecraft 版本，默认插件配置值' },
        loader: { type: 'string', enum: LOADER_ENUM, description: '目标加载器，默认插件配置值' },
        includeOptional: { type: 'boolean', description: '是否包含 optional 依赖，默认 false' },
        maxDepth: { type: 'integer', minimum: 1, maximum: 12, description: '依赖展开最大深度，默认插件配置值' },
      },
      required: ['projects'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const gameVersion = args.gameVersion ?? config.defaultGameVersion
      const loader = args.loader ?? config.defaultLoader
      const plan = await resolvePlan(
        config,
        {
          refs: args.projects,
          gameVersion,
          loader,
          includeOptional: args.includeOptional ?? false,
          maxDepth: args.maxDepth ?? Number(config.maxDependencyDepth ?? 6),
        },
        exec.signal,
      )
      const rows = plan.entries.map((entry) => [
        truncate(entry.title, 24),
        entry.slug,
        truncate(entry.versionNumber ?? entry.versionId ?? '?', 18),
        entry.versionType ?? '?',
        sideText(entry),
        entry.filename ?? '?',
        entry.direct ? '直接' : `依赖${entry.depth}`,
      ])
      const directCount = plan.entries.filter((entry) => entry.direct).length
      const lines = [
        `依赖解析完成：${plan.entries.length} 个项目（直接 ${directCount}，依赖 ${plan.entries.length - directCount}） | Minecraft ${gameVersion} / ${loader}`,
        '',
        formatTable(['名称', 'slug', '版本', '类型', '客户端/服务端', '文件名', '来源'], rows),
      ]
      if (plan.warnings.length) {
        lines.push('', `警告（${plan.warnings.length}）：`, ...plan.warnings.map((warning) => `- ${warning}`))
      } else {
        lines.push('', '没有冲突或缺失警告。')
      }
      lines.push('', '下一步：把 projects 列表传给 mc_pack 生成 .mrpack；或直接按清单配置服务端 mods/。')
      return {
        tool: 'mc_resolve',
        gameVersion,
        loader,
        entries: plan.entries.map((entry) => ({
          projectId: entry.projectId,
          slug: entry.slug,
          title: entry.title,
          projectType: entry.projectType,
          clientSide: entry.clientSide,
          serverSide: entry.serverSide,
          versionId: entry.versionId,
          versionNumber: entry.versionNumber,
          filename: entry.filename,
          url: entry.url,
          sha1: entry.sha1,
          sha512: entry.sha512,
          size: entry.size,
          direct: entry.direct,
          depth: entry.depth,
        })),
        warnings: plan.warnings,
        text: lines.join('\n'),
      }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_pack
  // ---------------------------------------------------------------------------
  const packTool = defineTool({
    name: 'mc_pack',
    description:
      '【临时构建】直接按传入的项目列表生成 .mrpack（不读写工程文件）。正式制作流程请用 mc_mods/mc_design 编辑工程，再用 mc_build 构建。' +
      '把一个项目列表解析成依赖树并生成标准 Modrinth .mrpack 整合包（modrinth.index.json + overrides），' +
      '可包含 overrides / client-overrides / server-overrides 目录。生成后可直接上传 Modrinth 或分发给客户端。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '整合包名称，例如 "永世幻想间"' },
        projects: { type: 'array', items: { type: 'string' }, description: '项目引用列表（slug 或 slug@versionId）' },
        output: { type: 'string', description: '输出 .mrpack 路径；相对路径基于工作目录，默认 packs/<name>-<versionId>.mrpack' },
        versionId: { type: 'string', description: '整合包版本标识，默认使用当天日期' },
        summary: { type: 'string', description: '整合包简介（可选）' },
        gameVersion: { type: 'string', description: '目标 Minecraft 版本，默认插件配置值' },
        loader: { type: 'string', enum: LOADER_ENUM, description: '整合包加载器，默认插件配置值' },
        loaderVersion: { type: 'string', description: '显式指定加载器版本（NeoForge/Fabric 可自动解析最新版）' },
        overridesDir: { type: 'string', description: '要打入 overrides/ 的本地目录（config、resourcepacks 等）' },
        clientOverridesDir: { type: 'string', description: '要打入 client-overrides/ 的本地目录' },
        serverOverridesDir: { type: 'string', description: '要打入 server-overrides/ 的本地目录' },
        includeOptional: { type: 'boolean', description: '是否打包 optional 依赖，默认 false' },
      },
      required: ['name', 'projects'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const gameVersion = args.gameVersion ?? config.defaultGameVersion
      const loader = args.loader ?? config.defaultLoader
      const versionId = args.versionId ?? new Date().toISOString().slice(0, 10)
      const root = await sessionRoot(exec)
      const outputPath = outPath(root, args.output, join('packs', `${slugify(args.name)}-${versionId}.mrpack`))
      const result = await buildMrpack(
        config,
        {
          name: args.name,
          versionId,
          summary: args.summary ?? '',
          projects: args.projects,
          gameVersion,
          loader,
          loaderVersion: args.loaderVersion,
          outputPath,
          overridesDir: args.overridesDir ? outPath(root, args.overridesDir) : undefined,
          clientOverridesDir: args.clientOverridesDir ? outPath(root, args.clientOverridesDir) : undefined,
          serverOverridesDir: args.serverOverridesDir ? outPath(root, args.serverOverridesDir) : undefined,
          includeOptional: args.includeOptional ?? false,
        },
        exec.signal,
      )
      const deps = Object.entries(result.dependencies)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')
      const lines = [
        `已生成 .mrpack：${result.outputPath}`,
        `输出根目录：${root}`,
        `大小 ${formatBytes(result.size)} | sha1 ${result.sha1} | mod 文件 ${result.files} 个 | overrides 文件 ${result.overrides} 个`,
        `Minecraft ${result.dependencies.minecraft ?? gameVersion} | ${deps}`,
        `依赖树项目数：${result.entryCount}`,
      ]
      if (result.skipped.length) lines.push('', '未打包（非 mod 资源）：', ...result.skipped.map((item) => `- ${item}`))
      if (result.warnings.length) lines.push('', '警告：', ...result.warnings.map((item) => `- ${item}`))
      lines.push('', '可用 mc_pack_check 校验服务端 mods/ 与包的差异。')
      return { tool: 'mc_pack', ...result, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_loader
  // ---------------------------------------------------------------------------
  const loaderTool = defineTool({
    name: 'mc_loader',
    description:
      '查询 Minecraft 版本与各加载器/服务端核心的可用版本：minecraft（Mojang 清单）、neoforge、fabric、paper、velocity、arclight（混合端），含下载直链。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: LOADER_KINDS, description: '要查询的类型' },
        gameVersion: { type: 'string', description: '目标 Minecraft 版本，默认插件配置值（velocity/minecraft 可忽略）' },
        version: { type: 'string', description: '具体版本（velocity 用来查 builds；paper 可留空）' },
        variant: { type: 'string', enum: ['neoforge', 'forge', 'fabric'], description: 'arclight 变体，默认跟随插件加载器' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数，默认 12' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const info = await loaderInfo(
        config,
        {
          kind: args.kind,
          gameVersion: args.gameVersion ?? config.defaultGameVersion,
          version: args.version,
          variant: args.variant,
          limit: args.limit ?? 12,
        },
        exec.signal,
      )
      const items = info.items ?? []
      const isBuildList = args.kind === 'paper' || (args.kind === 'velocity' && Boolean(args.version))
      const headers = isBuildList ? ['版本/构建', '通道', '日期', '文件', '大小', 'URL'] : ['版本', '类型/通道', '下载直链']
      const rows = items.map((item) => {
        if (isBuildList) {
          return [item.version, item.channel, formatDate(item.date), item.fileName ?? '?', formatBytes(item.size), item.url ?? '?']
        }
        return [item.version, item.channel ?? item.type ?? '-', item.url ?? item.serverJarUrl ?? '（见备注）']
      })
      const lines = [`${args.kind} 版本信息`]
      if (info.gameVersion) lines.push(`Minecraft ${info.gameVersion}${info.match ? ` | 匹配 ${info.match}` : ''}${info.total ? ` | 共 ${info.total} 个` : ''}`)
      if (info.latest) lines.push(`Mojang 最新：release ${info.latest.release} / snapshot ${info.latest.snapshot}`)
      if (info.installerUrl) lines.push(`安装器：${info.installerUrl}`)
      lines.push('', formatTable(headers, rows))
      if (info.notes?.length) lines.push('', ...info.notes.map((note) => `备注：${note}`))
      return { tool: 'mc_loader', ...info, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_server_config
  // ---------------------------------------------------------------------------
  const serverConfigTool = defineTool({
    name: 'mc_server_config',
    description:
      '生成 Minecraft 服务端目录骨架：server.properties、eula、启动脚本，以及 paper/velocity/arclight 的 bukkit/spigot/paper/velocity 配置；' +
      '支持 neoforge、fabric、paper、velocity、arclight（混合端）。可选下载对应服务端 jar。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: SERVER_KINDS, description: '服务端类型' },
        dir: { type: 'string', description: '输出目录；相对路径基于工作目录' },
        gameVersion: { type: 'string', description: '目标 Minecraft 版本，默认插件配置值' },
        loaderVersion: { type: 'string', description: '显式指定加载器版本' },
        velocityVersion: { type: 'string', description: 'velocity 具体版本（如 3.4.0-SNAPSHOT）' },
        arclightVariant: { type: 'string', enum: ['neoforge', 'forge', 'fabric'], description: 'arclight 变体' },
        downloadJar: { type: 'boolean', description: '是否下载服务端 jar（paper/velocity/fabric/arclight/neoforge 安装器），默认 false' },
        overwrite: { type: 'boolean', description: '是否覆盖已存在的文件，默认 false' },
        settings: {
          type: 'object',
          description:
            '自定义设置：motd、port、maxPlayers、onlineMode、difficulty、gamemode、pvp、viewDistance、simulationDistance、levelName、levelSeed、whitelist、java.minMemory/java.maxMemory、proxy.enabled/proxy.velocitySecret/proxy.velocityPort/proxy.lobbyAddress',
        },
      },
      required: ['kind', 'dir'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const root = await sessionRoot(exec)
      const dir = outPath(root, args.dir)
      const gameVersion = args.gameVersion ?? config.defaultGameVersion
      // Offline-friendly: reuse the version pinned in the project file for this loader
      // before reaching out to the loader's metadata service.
      let loaderVersion = args.loaderVersion
      if (!loaderVersion && (args.kind === 'neoforge' || args.kind === 'fabric')) {
        try {
          const project = await readProject(outPath(root, config.projectFile))
          if (project.target.loader === args.kind && project.target.minecraft === gameVersion && project.target.loaderVersion) {
            loaderVersion = project.target.loaderVersion
          }
        } catch {
          /* no project file yet */
        }
      }
      const result = await generateServerConfig(
        config,
        {
          kind: args.kind,
          dir,
          gameVersion,
          loaderVersion,
          velocityVersion: args.velocityVersion,
          arclightVariant: args.arclightVariant,
          downloadJar: args.downloadJar ?? false,
          overwrite: args.overwrite ?? false,
          settings: args.settings ?? {},
        },
        exec.signal,
      )
      const rows = result.files.map((file) => [file.path, file.status])
      const lines = [
        `已生成 ${result.kind} 服务端配置：${result.dir}`,
        '',
        formatTable(['文件', '状态'], rows),
      ]
      if (result.notes.length) lines.push('', '说明：', ...result.notes.map((note) => `- ${note}`))
      return { tool: 'mc_server_config', ...result, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_status
  // ---------------------------------------------------------------------------
  const statusTool = defineTool({
    name: 'mc_status',
    description:
      '通过 Java 版 Server List Ping 协议探测服务器是否在线，返回版本、玩家数、MOTD、延迟与 favicon 是否存在。适用于官网/QQ 群状态展示或运维巡检。',
    parameters: {
      type: 'object',
      properties: {
        host: { type: 'string', description: '服务器地址，如 "play.ipthmc.cn" 或 "127.0.0.1"' },
        port: { type: 'integer', minimum: 1, maximum: 65535, description: '端口；省略时先查 _minecraft._tcp SRV 记录，再回退 25565' },
        timeoutMs: { type: 'integer', minimum: 500, maximum: 20000, description: '超时毫秒，默认 5000' },
        protocolVersion: { type: 'integer', description: '握手协议号，默认 767（1.21.1）' },
      },
      required: ['host'],
      additionalProperties: false,
    },
    async execute(args) {
      const host = String(args.host ?? '').trim()
      let srv
      let port = args.port
      if (port === undefined) {
        srv = await resolveMinecraftSrv(host)
        port = srv?.port ?? 25565
      }
      const targetHost = srv?.host ?? host
      const srvText = srv
        ? `SRV：${srv.host}:${srv.port}（priority ${srv.priority}, weight ${srv.weight}）`
        : args.port === undefined
          ? 'SRV：无记录，直接使用 A 记录 + 25565'
          : 'SRV：未查询（显式指定了端口）'
      try {
        const status = await pingServer({
          host: targetHost,
          port,
          timeoutMs: args.timeoutMs ?? 5000,
          protocolVersion: args.protocolVersion ?? 767,
        })
        const lines = [
          `${host}${targetHost !== host ? ` → ${targetHost}` : ''}:${port} 在线`,
          srvText,
          `版本：${status.versionName}（protocol ${status.protocol ?? '?'}）`,
          `玩家：${status.playersOnline}/${status.playersMax}`,
          `MOTD：${status.motd || '（空）'}`,
          `延迟：${status.latencyMs} ms | favicon：${status.hasFavicon ? '有' : '无'}`,
        ]
        return { tool: 'mc_status', online: true, host, port, targetHost, srv, ...status, text: lines.join('\n') }
      } catch (error) {
        return {
          tool: 'mc_status',
          online: false,
          host,
          port,
          targetHost,
          srv,
          error: error.message,
          text: `${host}${targetHost !== host ? ` → ${targetHost}` : ''}:${port} 离线或不可达：${error.message}\n${srvText}`,
        }
      }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_pack_check
  // ---------------------------------------------------------------------------
  const packCheckTool = defineTool({
    name: 'mc_pack_check',
    description:
      '校验服务端目录与 .mrpack 是否一致：按 modrinth.index.json 检查服务端应安装的 mods 是否缺失、sha1 是否匹配，并列出目录里多余的 jar。',
    parameters: {
      type: 'object',
      properties: {
        pack: { type: 'string', description: '.mrpack 文件路径' },
        serverDir: { type: 'string', description: '服务端目录（包含 mods/ 或 plugins/）' },
        checkHashes: { type: 'boolean', description: '是否校验 sha1，默认 true' },
      },
      required: ['pack', 'serverDir'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const root = await sessionRoot(exec)
      const packPath = outPath(root, args.pack)
      const serverDir = outPath(root, args.serverDir)
      const result = await checkPackAgainstServer(packPath, serverDir, { checkHashes: args.checkHashes ?? true })
      const dependencies = Object.entries(result.dependencies ?? {})
        .filter(([key]) => key !== 'minecraft')
        .map(([key, value]) => `${key} ${value}`)
        .join(' / ')
      const lines = [
        `包：${packPath}`,
        `Minecraft ${result.dependencies?.minecraft ?? '?'} | ${dependencies || '无加载器依赖'}`,
        `服务端应安装：${result.expected} 个文件 | 缺失 ${result.missing.length} | 哈希不匹配 ${result.mismatched.length} | 目录多余 ${result.extra.length}`,
      ]
      if (result.missing.length) lines.push('', '缺失：', ...result.missing.map((item) => `- ${item.path}${item.disabled ? '（存在 .disabled，可能已被禁用）' : ''}`))
      if (result.mismatched.length) {
        lines.push('', '哈希不匹配：', ...result.mismatched.map((item) => `- ${item.path}（期望 ${String(item.expected).slice(0, 12)}…，实际 ${item.actual.slice(0, 12)}…）`))
      }
      if (result.extra.length) lines.push('', '目录中多余的 jar（未在包中声明，可能需要移除以保证一致性）：', ...result.extra.map((item) => `- ${item}`))
      if (result.ok) lines.push('', '服务端 mods 与整合包完全一致。')
      return { tool: 'mc_pack_check', pack: packPath, serverDir, ...result, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_pack_install
  // ---------------------------------------------------------------------------
  const packInstallTool = defineTool({
    name: 'mc_pack_install',
    description:
      '把 .mrpack 的服务端内容自动安装到服务器目录：下载 mods/ 文件并校验 sha1，解压 overrides/ 与 server-overrides/（跳过 client-overrides）。' +
      '用于「整合包 → 服务端」一体化部署；装完可用 mc_pack_check 复核。',
    parameters: {
      type: 'object',
      properties: {
        pack: { type: 'string', description: '.mrpack 文件路径' },
        serverDir: { type: 'string', description: '服务端目录（文件会按包内相对路径写入）' },
        overwrite: { type: 'boolean', description: '是否覆盖已存在且 sha1 不一致的文件，默认 false' },
        includeOverrides: { type: 'boolean', description: '是否解压 overrides/ 与 server-overrides/，默认 true' },
        dryRun: { type: 'boolean', description: '只列出将下载/写入的文件，不实际执行，默认 false' },
      },
      required: ['pack', 'serverDir'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const root = await sessionRoot(exec)
      const packPath = outPath(root, args.pack)
      const serverDir = outPath(root, args.serverDir)
      const result = await installMrpackToServer(
        config,
        {
          packPath,
          serverDir,
          overwrite: args.overwrite ?? false,
          includeOverrides: args.includeOverrides ?? true,
          dryRun: args.dryRun ?? false,
        },
        exec.signal,
      )
      const lines = [
        `${result.dryRun ? '[dry-run] ' : ''}已把 ${packPath} 安装到 ${serverDir}`,
        `应安装文件 ${result.expected} 个 | 下载 ${result.downloaded.length} | 已存在跳过 ${result.skipped.length} | 失败 ${result.failed.length} | 写入 ${formatBytes(result.bytes)}`,
      ]
      if (result.downloaded.length) {
        lines.push('', '下载：', ...result.downloaded.map((item) => `- ${item.path}${item.bytes ? `（${formatBytes(item.bytes)}）` : ''}`))
      }
      if (result.skipped.length) lines.push('', '跳过（已存在且校验通过）：', ...result.skipped.map((item) => `- ${item.path}`))
      if (result.failed.length) lines.push('', '失败：', ...result.failed.map((item) => `- ${item.path}：${item.reason}`))
      if (result.overrides.length) {
        const writtenOverrides = result.overrides.filter((item) => item.status !== 'skipped')
        lines.push('', `overrides 写入 ${writtenOverrides.length} 个，跳过 ${result.overrides.length - writtenOverrides.length} 个。`)
      }
      return { tool: 'mc_pack_install', ...result, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })


  // ---------------------------------------------------------------------------
  // mc_project — engineering project management (authoring entry point)
  // ---------------------------------------------------------------------------
  const projectManageTool = defineTool({
    name: 'mc_project',
    description:
      '通用工程管理（制作工具入口）：list 项目列表 / create 新建项目 / register 注册已有目录 / use 切换当前项目 / remove 移出注册表 / show 查看 / init 初始化目录 / update 修改工程字段。' +
      '工程文件（默认 project.json）是唯一事实源；构建产物只是输出。多项目通过注册表（默认 ~/.craft-workshop/projects.json）管理，其他工具可用 project 参数指定项目。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['show', 'init', 'update', 'list', 'create', 'register', 'use', 'remove'],
          description: 'show 查看 / init 初始化 / update 修改 / list 项目列表 / create 新建项目 / register 注册目录 / use 切换激活项目 / remove 移出注册表',
        },
        path: { type: 'string', description: '工程文件路径，默认 project.json' },
        project: { type: 'string', description: '注册表项目 id（use/remove/list 时的目标，其他动作也可用它指定项目）' },
        dir: { type: 'string', description: 'create/register 的目标目录（绝对路径或相对会话目录）' },
        id: { type: 'string', description: 'create/register 时显式指定项目 id（小写字母/数字/-/_/.)，省略则用目录名' },
        template: { type: 'string', enum: ['modpack', 'server', 'empty'], description: 'create 的模板：modpack（默认，含设计目录）/ server / empty' },
        mods: { type: 'array', items: { type: 'string' }, description: 'create 时的种子模组列表（slug 或 slug@versionId）' },
        git: { type: 'boolean', description: 'create 时是否执行 git init（默认 false）' },
        use: { type: 'boolean', description: 'create/register 后是否切换为当前项目（create 默认 true）' },
        name: { type: 'string', description: '整合包名称' },
        versionId: { type: 'string', description: '整合包版本标识' },
        summary: { type: 'string', description: '整合包简介' },
        minecraft: { type: 'string', description: '目标 Minecraft 版本' },
        loader: { type: 'string', enum: LOADER_ENUM, description: '目标加载器' },
        loaderVersion: { type: 'string', description: '加载器版本（留空自动取最新）' },
        outputDir: { type: 'string', description: '构建输出目录，默认 builds' },
        designRoot: { type: 'string', description: '设计内容目录，默认 design' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const sessionRootPath = await sessionRoot(exec)
      const target = await targetFor(exec, args.project, args.path)
      const root = target.root
      const file = target.file

      if (args.action === 'list') {
        const listing = await registry.list()
        const rows = []
        for (const entry of listing.projects) {
          const exists = await stat(join(entry.root, entry.projectFile || config.projectFile))
            .then(() => true)
            .catch(() => false)
          rows.push([entry.id, entry.name, exists ? '✅' : '❌ 工程文件缺失', entry.kind, entry.root])
        }
        const lines = [
          `已注册项目：${listing.projects.length} 个`,
          `注册表：${listing.file}`,
          listing.active ? `当前激活项目：${listing.active}` : '当前激活项目：（无；工具默认使用会话工作目录）',
          '',
        ]
        lines.push(rows.length ? formatTable(['id', '名称', '状态', '类型', '目录'], rows) : '（还没有项目：mc_project action=create 新建，或 action=register 注册已有目录）')
        lines.push('', '切换：mc_project action=use project=<id>；Web UI 顶部也有项目下拉。')
        return { tool: 'mc_project', action: 'list', registry: listing, text: lines.join('\n') }
      }

      if (args.action === 'create') {
        if (!args.name) throw new Error('create 需要 name')
        const template = args.template ?? 'modpack'
        const dirArg = args.dir ?? slugifyProject(args.name)
        const dir = isAbsolute(dirArg) ? dirArg : resolvePath(sessionRootPath, dirArg)
        const projectFile = resolvePath(dir, config.projectFile)
        if (await stat(projectFile).then(() => true).catch(() => false)) {
          throw new Error(`目录里已有工程文件：${projectFile}（要接管现有项目请用 action=register）`)
        }
        const project = defaultProject(args.name)
        project.kind = template === 'server' ? 'server' : template === 'empty' ? 'empty' : 'modpack'
        if (args.minecraft) project.target.minecraft = args.minecraft
        if (args.loader) project.target.loader = args.loader
        if (args.loaderVersion) project.target.loaderVersion = args.loaderVersion
        if (Array.isArray(args.mods) && args.mods.length) addMods(project, args.mods)
        if (template === 'server') {
          project.servers = { mod: { kind: project.target.loader, dir: 'server' } }
        }
        await mkdir(dir, { recursive: true })
        await writeProject(projectFile, project)
        const notes = []
        if (template !== 'empty') {
          const designRoot = resolvePath(dir, project.design?.root ?? config.designRoot)
          await ensureDesignScaffold(designRoot)
          notes.push(`设计目录：${designRoot}`)
        }
        const overridesDir = resolvePath(dir, project.pack.overrides?.overrides || 'overrides')
        const outputDir = resolvePath(dir, project.pack.outputDir || 'builds')
        await mkdir(overridesDir, { recursive: true })
        await mkdir(outputDir, { recursive: true })
        if (args.git) {
          try {
            execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
            notes.push('已初始化 git 仓库')
          } catch (error) {
            notes.push(`git init 失败（可手动执行）：${error.message}`)
          }
        }
        const entry = await registry.register({
          root: dir,
          name: project.name,
          id: args.id,
          projectFile: config.projectFile,
          kind: project.kind,
          source: 'created',
          activate: args.use !== false,
        })
        const lines = [
          `已创建项目：${project.name}（${entry.id}）`,
          `目录：${dir}`,
          `模板：${template} | 目标：Minecraft ${project.target.minecraft} / ${project.target.loader} ${project.target.loaderVersion || '（自动）'}`,
          project.pack.mods.length ? `种子模组：${project.pack.mods.map((mod) => mod.id).join(', ')}` : '种子模组：（无）',
          ...notes,
          '',
          '下一步：mc_mods 加模组 → mc_design 写内容 → mc_export 导出 → mc_build 构建。',
        ]
        return { tool: 'mc_project', action: 'create', dir, file: projectFile, entry, template, text: lines.join('\n') }
      }

      if (args.action === 'register') {
        const dirArg = args.dir ?? args.path
        if (!dirArg) throw new Error('register 需要 dir（项目目录）')
        const dir = isAbsolute(dirArg) ? dirArg : resolvePath(sessionRootPath, dirArg)
        const projectFilePath = resolvePath(dir, config.projectFile)
        let project
        try {
          project = await readProject(projectFilePath)
        } catch (error) {
          throw new Error(`目录里没有可用的工程文件：${error.message}`)
        }
        const entry = await registry.register({
          root: dir,
          name: args.name ?? project.name,
          id: args.id,
          projectFile: config.projectFile,
          kind: project.kind ?? 'modpack',
          source: 'registered',
          activate: args.use === true,
        })
        return {
          tool: 'mc_project',
          action: 'register',
          dir,
          entry,
          text: `已注册项目：${entry.name}（${entry.id}）\n目录：${dir}${entry.id === (await registry.list()).active ? '\n已设为当前项目。' : ''}`,
        }
      }

      if (args.action === 'use') {
        const active = await registry.setActive(args.project ?? '')
        return {
          tool: 'mc_project',
          action: 'use',
          active,
          text: active
            ? `已切换当前项目：${active}（其他工具不带 project 参数时仍使用会话工作目录）`
            : '已清除当前项目；工具将使用会话工作目录。',
        }
      }

      if (args.action === 'remove') {
        if (!args.project) throw new Error('remove 需要 project=<id>')
        const result = await registry.remove(args.project)
        return {
          tool: 'mc_project',
          action: 'remove',
          ...result,
          text: result.removed ? `已从注册表移除 ${args.project}（项目文件未删除）` : `注册表里没有 ${args.project}`,
        }
      }

      if (args.action === 'init') {
        let project
        let created = false
        try {
          project = await readProject(file)
        } catch {
          project = defaultProject(args.name ?? '未命名整合包')
          await writeProject(file, project)
          created = true
        }
        const designRoot = resolvePath(root, project.design?.root ?? config.designRoot)
        const scaffold = await ensureDesignScaffold(designRoot)
        const overridesDir = resolvePath(root, project.pack.overrides?.overrides ?? 'overrides')
        const outputDir = resolvePath(root, project.pack.outputDir ?? 'builds')
        await mkdir(overridesDir, { recursive: true })
        await mkdir(outputDir, { recursive: true })
        const lines = [
          created ? `已创建工程文件：${file}` : `工程文件已存在：${file}（已补齐目录）`,
          `设计目录：${designRoot}`,
          `设计类型：${scaffold.kinds.join(', ')}`,
          `覆盖目录：${overridesDir}`,
          `构建输出：${outputDir}`,
          '',
          '下一步：mc_mods 添加模组 → mc_design 编写剧情/任务 → mc_export 导出 → mc_build 构建。',
        ]
        return { tool: 'mc_project', action: 'init', file, created, designRoot, overridesDir, outputDir, text: lines.join('\n') }
      }

      if (args.action === 'update') {
        const project = await readProject(file)
        const before = projectSummary(project)
        const changes = []
        if (args.name) {
          project.name = args.name
          changes.push(`name → ${args.name}`)
        }
        if (args.versionId) {
          project.pack.versionId = args.versionId
          changes.push(`versionId → ${args.versionId}`)
        }
        if (args.summary !== undefined) {
          project.pack.summary = args.summary
          changes.push('summary 已更新')
        }
        if (args.minecraft) {
          project.target.minecraft = args.minecraft
          changes.push(`minecraft → ${args.minecraft}`)
        }
        if (args.loader) {
          project.target.loader = args.loader
          changes.push(`loader → ${args.loader}`)
        }
        if (args.loaderVersion !== undefined) {
          project.target.loaderVersion = args.loaderVersion
          changes.push(`loaderVersion → ${args.loaderVersion || '（自动）'}`)
        }
        if (args.outputDir) {
          project.pack.outputDir = args.outputDir
          changes.push(`outputDir → ${args.outputDir}`)
        }
        if (args.designRoot) {
          project.design.root = args.designRoot
          changes.push(`designRoot → ${args.designRoot}`)
        }
        if (!changes.length) throw new Error('没有需要修改的字段（name/versionId/summary/minecraft/loader/loaderVersion/outputDir/designRoot）')
        await writeProject(file, project)
        const after = projectSummary(project)
        const lines = [`工程已更新：${file}`, '', ...changes.map((change) => `- ${change}`), '', `目标：Minecraft ${after.target.minecraft} / ${after.target.loader} ${after.target.loaderVersion || '（自动）'}`, `模组：${after.modsCount} 个 | 包版本：${after.versionId}`]
        return { tool: 'mc_project', action: 'update', file, before, after, changes, text: lines.join('\n') }
      }

      const project = await readProject(file)
      const summary = projectSummary(project)
      const lines = [
        `工程：${summary.name}（${summary.id}）`,
        `工程文件：${file}`,
        `目标：Minecraft ${summary.target.minecraft} / ${summary.target.loader} ${summary.target.loaderVersion || '（自动最新）'}`,
        `包版本：${summary.versionId} | 模组：${summary.modsCount} 个（锁定 ${summary.pinnedCount}）`,
        `设计目录：${resolvePath(root, summary.designRoot)}`,
        `输出目录：${resolvePath(root, summary.outputDir)}`,
        `覆盖目录：overrides=${summary.overrides?.overrides || '（无）'} / client=${summary.overrides?.clientOverrides || '（无）'} / server=${summary.overrides?.serverOverrides || '（无）'}`,
      ]
      if (summary.content?.length) {
        lines.push('', '内容导出映射：')
        for (const mapping of summary.content) lines.push(`- ${mapping.from} → ${mapping.zone}/${mapping.to}`)
      }
      lines.push('', '命令：mc_mods 编辑模组；mc_design 编辑设计；mc_export 导出游戏格式；mc_build 构建 .mrpack。')
      return { tool: 'mc_project', action: 'show', file, summary, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_mods — mod list authoring in the project file
  // ---------------------------------------------------------------------------
  const modsTool = defineTool({
    name: 'mc_mods',
    description:
      '编辑工程文件里的模组清单（整合包制作核心）：list 列表 / add 添加（自动解析依赖并报告冲突）/ remove 移除 / pin 锁定版本 / unpin 解锁 / resolve 解析依赖树。' +
      'add/remove/pin/unpin 直接写回工程文件；正式流程先 resolve 检查再 mc_build 构建。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'remove', 'pin', 'unpin', 'resolve'], description: '操作类型' },
        refs: { type: 'array', items: { type: 'string' }, description: '模组引用列表：slug、slug@versionId、projectId' },
        versionId: { type: 'string', description: 'pin 使用的版本 id（也可直接写 refs 里的 slug@versionId）' },
        path: { type: 'string', description: '工程文件路径，默认 project.json' },
        project: { type: 'string', description: '注册表项目 id（mc_project action=list 查看）；省略则使用当前会话工作目录' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const { file } = await projectFileFor(exec, args.path, args.project)
      const project = await readProject(file)
      const action = args.action
      const refs = Array.isArray(args.refs) ? args.refs.filter(Boolean) : []
      if (['add', 'remove', 'pin', 'unpin'].includes(action) && !refs.length) throw new Error(`${action} 需要 refs 参数`)
      if (action === 'pin' && !args.versionId && !refs.some((ref) => ref.includes('@'))) throw new Error('pin 需要 versionId 参数或 slug@versionId 形式')

      let changed = []
      if (action === 'add') {
        changed = addMods(project, refs)
        if (!changed.length) {
          return { tool: 'mc_mods', action, file, changed, text: `没有新增模组（都已存在于工程中）\n当前模组：${project.pack.mods.length} 个` }
        }
        await writeProject(file, project)
      } else if (action === 'remove') {
        changed = removeMods(project, refs)
        await writeProject(file, project)
      } else if (action === 'pin') {
        const mod = pinMod(project, refs[0], args.versionId)
        changed = [mod]
        await writeProject(file, project)
      } else if (action === 'unpin') {
        changed = unpinMod(project, refs)
        await writeProject(file, project)
      }

      if (action === 'list') {
        const mods = project.pack.mods
        const rows = mods.map((mod, index) => [index + 1, mod.id, mod.versionId ?? '（跟随最新）', mod.note ?? ''])
        const lines = [`工程模组清单：${project.name}（${mods.length} 个，锁定 ${mods.filter((mod) => mod.versionId).length}）`, '']
        lines.push(mods.length ? formatTable(['#', '模组', '锁定版本', '备注'], rows) : '（还没有模组，用 mc_mods action=add 添加）')
        return { tool: 'mc_mods', action, file, mods, text: lines.join('\n') }
      }

      let plan
      let planError
      try {
        plan = await resolveProject(config, project, exec.signal)
      } catch (error) {
        planError = error.message
      }
      const lines = []
      if (action === 'resolve') {
        lines.push(`依赖解析：${project.name} | Minecraft ${project.target.minecraft} / ${project.target.loader}`)
      } else {
        lines.push(`工程模组已更新：${project.name}（${project.pack.mods.length} 个）`)
        if (changed.length) lines.push('', '变更：', ...changed.map((mod) => `- ${mod.id ?? mod}${mod.versionId ? `@${mod.versionId}` : ''}`))
      }
      if (planError) {
        lines.push('', `依赖解析失败：${planError}`)
      } else if (plan) {
        const directCount = plan.entries.filter((entry) => entry.direct).length
        lines.push('', `解析到 ${plan.entries.length} 个项目（直接 ${directCount}，依赖 ${plan.entries.length - directCount}）：`)
        lines.push(
          formatTable(
            ['名称', 'slug', '版本', '客户端/服务端', '文件名'],
            plan.entries.map((entry) => [truncate(entry.title, 22), entry.slug, truncate(entry.versionNumber ?? '?', 18), sideText(entry), entry.filename ?? '?']),
          ),
        )
        if (plan.warnings.length) lines.push('', '警告：', ...plan.warnings.map((warning) => `- ${warning}`))
        else lines.push('', '没有冲突或缺失警告。')
      }
      lines.push('', '下一步：mc_build 从工程构建 .mrpack。')
      return { tool: 'mc_mods', action, file, changed: changed.map((mod) => mod.id ?? mod), plan: plan ? { total: plan.entries.length, warnings: plan.warnings } : null, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_design — story / quest / character / worldbuilding authoring
  // ---------------------------------------------------------------------------
  const designTool = defineTool({
    name: 'mc_design',
    description:
      '编辑整合包设计内容（剧情/任务/人物/势力/地点/世界观/物品/配方）：list 列表 / get 读取 / write 新建或合并 / delete 删除 / check 全量校验（字段 + 交叉引用）/ describe 查看某类字段说明。' +
      '内容以 design/<kind>/<id>.json 存盘，是创作源文件；改完用 mc_export 导出游戏格式、mc_build 构建。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'write', 'delete', 'check', 'describe'], description: '操作类型' },
        kind: { type: 'string', enum: DESIGN_KIND_NAMES, description: '设计类型' },
        id: { type: 'string', description: '条目 id（文件名，字母/数字/汉字/点/下划线/中划线）' },
        data: { type: 'object', description: 'write 用的 JSON 对象（顶层字段合并进已有条目）' },
        replace: { type: 'boolean', description: 'write 时整体替换而非合并，默认 false' },
        designRoot: { type: 'string', description: '设计目录路径覆盖，默认读工程文件的 design.root' },
        path: { type: 'string', description: '工程文件路径，默认 project.json' },
        project: { type: 'string', description: '注册表项目 id；省略则使用当前会话工作目录' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const { root, file, designRoot: defaultDesignRoot } = await projectPaths(exec, args.path, args.project)
      const designRoot = args.designRoot ? outPath(root, args.designRoot) : defaultDesignRoot
      const action = args.action

      if (action === 'describe') {
        if (!args.kind) throw new Error('describe 需要 kind 参数')
        const meta = DESIGN_KINDS[args.kind]
        const lines = [
          `${args.kind}（${meta.label}）→ design/${meta.dir}/<id>.json`,
          meta.description,
          '',
          `必填字段：${meta.required.join(', ')}`,
          `常用字段：${meta.fields.join(', ')}`,
          '',
          '示例：',
          JSON.stringify(meta.example, null, 2),
        ]
        return { tool: 'mc_design', action, kind: args.kind, meta, text: lines.join('\n') }
      }

      if (action === 'check') {
        const report = await checkDesign(designRoot)
        const rows = DESIGN_KIND_NAMES.map((kind) => [kind, DESIGN_KINDS[kind].label, report.stats[kind] ?? 0])
        const lines = [`设计校验：${designRoot}`, `共 ${report.total} 条设计内容，${report.ok ? '✅ 通过' : '❌ 存在问题'}`, '', formatTable(['kind', '类型', '数量'], rows)]
        if (report.errors.length) lines.push('', `错误（${report.errors.length}）：`, ...report.errors.map((message) => `- ${message}`))
        if (report.warnings.length) lines.push('', `警告（${report.warnings.length}）：`, ...report.warnings.map((message) => `- ${message}`))
        if (report.info.length) lines.push('', '提示：', ...report.info.map((message) => `- ${message}`))
        if (!report.errors.length && !report.warnings.length) lines.push('', '没有错误或警告。')
        return { tool: 'mc_design', action, designRoot, ...report, text: lines.join('\n') }
      }

      if (!args.kind) throw new Error(`${action} 需要 kind 参数`)
      const meta = DESIGN_KINDS[args.kind]

      if (action === 'list') {
        const listed = await listEntries(designRoot, args.kind)
        const rows = listed.entries.map((entry) => {
          const extra = entry.quests !== undefined ? `任务 ${entry.quests}` : entry.hasBody ? '有正文' : entry.type ?? entry.faction ?? entry.namespace ?? ''
          return [entry.id, entry.title, entry.order ?? '', extra]
        })
        const lines = [`${meta.label}：${listed.entries.length} 条（design/${meta.dir}/）`]
        if (listed.entries.length) lines.push('', formatTable(['id', '标题', 'order', '备注'], rows))
        else lines.push('', '（空，用 mc_design action=write 创建）')
        if (listed.warnings.length) lines.push('', '解析警告：', ...listed.warnings.map((warning) => `- ${warning}`))
        return { tool: 'mc_design', action, kind: args.kind, designRoot, entries: listed.entries, warnings: listed.warnings, text: lines.join('\n') }
      }

      if (!args.id) throw new Error(`${action} 需要 id 参数`)

      if (action === 'get') {
        const entry = await getEntry(designRoot, args.kind, args.id)
        return { tool: 'mc_design', action, kind: args.kind, id: args.id, path: entry.path, data: entry.data, text: `${meta.label} ${args.kind}/${args.id}：\n\n${JSON.stringify(entry.data, null, 2)}` }
      }

      if (action === 'delete') {
        const result = await deleteEntry(designRoot, args.kind, args.id)
        return {
          tool: 'mc_design',
          action,
          kind: args.kind,
          id: args.id,
          path: result.path,
          deleted: result.deleted,
          text: result.deleted ? `已删除 ${args.kind}/${args.id}（${result.path}）` : `条目不存在：${args.kind}/${args.id}`,
        }
      }

      // write
      if (!args.data || typeof args.data !== 'object') throw new Error('write 需要 data 对象')
      const result = await writeEntry(designRoot, args.kind, args.id, args.data, { replace: args.replace ?? false })
      let relevant = []
      try {
        const report = await checkDesign(designRoot)
        relevant = [...report.errors, ...report.warnings].filter((message) => message.includes(`[${args.kind}/${args.id}]`))
      } catch {
        /* validation is best effort */
      }
      const validation = result.validation
      const lines = [
        result.created ? `已创建 ${meta.label}：${args.kind}/${args.id}` : `已更新 ${meta.label}：${args.kind}/${args.id}`,
        `文件：${result.path}`,
      ]
      if (!validation.ok) lines.push('', '字段错误：', ...validation.errors.map((message) => `- ${message}`))
      if (validation.warnings.length) lines.push('', '字段警告：', ...validation.warnings.map((message) => `- ${message}`))
      if (relevant.length) lines.push('', '交叉引用问题：', ...relevant.map((message) => `- ${message}`))
      if (validation.ok && !relevant.length) lines.push('', '字段与引用校验通过。')
      lines.push('', '提示：mc_design action=check 可做全量校验；mc_export 导出游戏格式。')
      return { tool: 'mc_design', action, kind: args.kind, id: args.id, path: result.path, created: result.created, validation, relevant, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_export — design sources -> game files
  // ---------------------------------------------------------------------------
  const exportTool = defineTool({
    name: 'mc_export',
    description:
      '把 design/ 设计内容导出成游戏内格式：design-wiki（设计文档 Markdown）、ftbquests（FTB Quests 任务 SNBT）、patchouli（Patchouli 指南书 JSON）、kubejs（KubeJS 物品/配方草稿）。' +
      '导出会写入 build/exports/<target>/，再由工程文件 pack.content 映射进整合包；导出前建议先 mc_design action=check。',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['all', 'design-wiki', 'ftbquests', 'patchouli', 'kubejs'], description: '导出目标，all 导出全部' },
        outDir: { type: 'string', description: '导出根目录，默认 build/exports' },
        namespace: { type: 'string', description: '导出使用的命名空间，默认工程 id' },
        language: { type: 'string', description: '语言目录（zh_cn/en_us），默认 zh_cn' },
        designRoot: { type: 'string', description: '设计目录路径覆盖' },
        path: { type: 'string', description: '工程文件路径，默认 project.json' },
        project: { type: 'string', description: '注册表项目 id；省略则使用当前会话工作目录' },
      },
      required: ['target'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const { root, file, designRoot: defaultDesignRoot } = await projectPaths(exec, args.path, args.project)
      const designRoot = args.designRoot ? outPath(root, args.designRoot) : defaultDesignRoot
      let project
      try {
        project = await readProject(file)
      } catch {
        project = undefined
      }
      const exportBase = args.outDir ? outPath(root, args.outDir) : resolvePath(root, 'build/exports')
      const namespace = args.namespace ?? project?.id ?? config.defaultNamespace
      const language = args.language ?? 'zh_cn'
      const targets = args.target === 'all' ? ['design-wiki', 'ftbquests', 'patchouli', 'kubejs'] : [args.target]
      const results = []
      const lines = [`设计导出：${designRoot}`, `输出根目录：${exportBase} | namespace=${namespace} | language=${language}`, '']
      for (const target of targets) {
        try {
          let result
          if (target === 'design-wiki') {
            result = await exportDesignWiki(designRoot, resolvePath(exportBase, 'design-wiki'))
          } else if (target === 'ftbquests') {
            result = await exportFtbQuests({ config, project, designRoot, projectRoot: root, outDir: resolvePath(exportBase, 'ftbquests'), namespace, language, signal: exec.signal })
          } else if (target === 'patchouli') {
            result = await exportPatchouli({ config, project, designRoot, projectRoot: root, outDir: resolvePath(exportBase, 'patchouli'), namespace, language, signal: exec.signal })
          } else if (target === 'kubejs') {
            result = await exportKubeJs({ config, project, designRoot, projectRoot: root, outDir: resolvePath(exportBase, 'kubejs'), namespace, language, signal: exec.signal })
          }
          results.push({ target, ...result })
          lines.push(`✅ ${target}：${result.summary ?? `${(result.files ?? []).length} 个文件`}`)
          if (result.outDir) lines.push(`   → ${result.outDir}`)
          for (const warning of result.warnings ?? []) lines.push(`   ⚠️ ${warning}`)
        } catch (error) {
          results.push({ target, error: error.message })
          lines.push(`❌ ${target}：${error.message}`)
        }
      }
      lines.push('', '导出完成后：确认 project.json 的 pack.content 映射（from→zone/to），再用 mc_build 构建整合包。')
      return { tool: 'mc_export', target: args.target, namespace, language, results, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_build — build the mrpack from the project file
  // ---------------------------------------------------------------------------
  const buildTool = defineTool({
    name: 'mc_build',
    description:
      '从工程文件构建整合包（正式流程）：读取 project.json 的模组清单、目标版本、overrides 目录与 pack.content 导出映射，解析依赖后生成 .mrpack 到 builds/。' +
      '本工具只负责构建产物；内容创作请改工程文件与 design/，再用 mc_export。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '工程文件路径，默认 project.json' },
        versionId: { type: 'string', description: '覆盖工程里的包版本标识' },
        output: { type: 'string', description: '输出 .mrpack 路径；默认 builds/<name>-<versionId>.mrpack' },
        includeOptional: { type: 'boolean', description: '是否打包 optional 依赖，默认 false' },
        project: { type: 'string', description: '注册表项目 id；省略则使用当前会话工作目录' },
      },
      additionalProperties: false,
    },
    async execute(args, exec) {
      const { root, file } = await projectFileFor(exec, args.path, args.project)
      const result = await buildFromProject(
        config,
        {
          projectRoot: root,
          projectPath: file,
          versionId: args.versionId,
          outputPath: args.output ? outPath(root, args.output) : undefined,
          includeOptional: args.includeOptional ?? false,
        },
        exec.signal,
      )
      const deps = Object.entries(result.dependencies)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')
      const lines = [
        `已从工程构建：${result.outputPath}`,
        `工程：${result.project.name} | Minecraft ${result.dependencies.minecraft} | ${deps}`,
        `大小 ${formatBytes(result.size)} | sha1 ${result.sha1}`,
        `mod 文件 ${result.files} 个 | overrides ${result.overrides} 个 | 内容映射文件 ${result.contentFiles ?? 0} 个`,
      ]
      if (result.contentMappings?.length) {
        lines.push('', '内容映射：', ...result.contentMappings.map((mapping) => `- ${mapping.from} → ${mapping.zone}/${mapping.to}（${mapping.files} 文件）`))
      }
      if (result.contentWarnings?.length) lines.push('', '内容警告：', ...result.contentWarnings.map((warning) => `- ${warning}`))
      if (result.skipped?.length) lines.push('', '未打包：', ...result.skipped.map((item) => `- ${item}`))
      if (result.warnings?.length) lines.push('', '依赖警告：', ...result.warnings.map((warning) => `- ${warning}`))
      lines.push('', '可用 mc_pack_install / mc_pack_check 同步与校验服务端。')
      return { tool: 'mc_build', ...result, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_market — mod/plugin marketplace
  // ---------------------------------------------------------------------------
  const marketTool = defineTool({
    name: 'mc_market',
    description:
      '模组/插件市场：search 搜索（分类 / 加载器 / 版本 / 端侧）、categories 分类清单、install-mods 装进工程模组清单、install-plugins 下载服务端插件到 plugins/、installed 查看已装内容。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'categories', 'install-mods', 'install-plugins', 'installed'], description: '操作类型' },
        query: { type: 'string', description: '搜索关键词（与分类关键词合并）' },
        category: { type: 'string', enum: MARKET_CATEGORIES.map((item) => item.id), description: '市场分类' },
        projectType: { type: 'string', enum: PROJECT_TYPES, description: '资源类型，默认跟随分类（mod / plugin）' },
        loaders: { type: 'array', items: { type: 'string', enum: LOADER_ENUM }, description: '加载器过滤，默认工程目标加载器' },
        gameVersions: { type: 'array', items: { type: 'string' }, description: 'Minecraft 版本，默认工程目标版本' },
        side: { type: 'string', enum: ['client', 'server'], description: '只看客户端可用 / 服务端可用' },
        sortBy: { type: 'string', enum: SORT_INDEXES, description: '排序，默认下载量' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数，默认 12' },
        refs: { type: 'array', items: { type: 'string' }, description: 'install 用的项目引用（slug 或 slug@versionId）' },
        overwrite: { type: 'boolean', description: 'install-plugins 是否覆盖同名 jar' },
        project: { type: 'string', description: '注册表项目 id；省略则使用当前会话工作目录' },
        path: { type: 'string', description: '工程文件路径' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const { root, file } = await projectFileFor(exec, args.path, args.project)
      const project = await readProject(file).catch(() => undefined)
      const gameVersions = args.gameVersions?.length ? args.gameVersions : project ? [project.target.minecraft] : [config.defaultGameVersion]
      const loaders = args.loaders?.length ? args.loaders : project ? [project.target.loader] : [config.defaultLoader]

      if (args.action === 'categories') {
        const rows = marketCategories().map((item) => [item.id, item.label, item.type, item.loaders.join('/') || '-', item.keywords])
        return {
          tool: 'mc_market',
          action: 'categories',
          categories: marketCategories(),
          text: ['市场分类：', '', formatTable(['id', '名称', '类型', '默认加载器', '关键词'], rows), '', '用法：mc_market action=search category=performance'].join('\n'),
        }
      }

      if (args.action === 'search') {
        const result = await marketSearch(config, {
          category: args.category,
          query: args.query ?? '',
          projectType: args.projectType,
          loaders,
          gameVersions,
          side: args.side,
          sortBy: args.sortBy,
          limit: args.limit ?? 12,
        }, exec.signal)
        const rows = result.hits.map((hit) => [hit.slug, truncate(hit.title, 24), hit.downloads, sideText(hit), formatDate(hit.updated), truncate(hit.description, 40)])
        const lines = [
          `市场搜索${args.category ? ` · ${args.category}` : ''}${args.query ? ` · ${args.query}` : ''}｜版本 ${gameVersions.join(',')}｜加载器 ${loaders.join(',')}`,
          `命中 ${result.totalHits}，显示 ${result.hits.length}`,
          '',
          formatTable(['slug', '名称', '下载', '客户端/服务端', '更新', '简介'], rows),
          '',
          '安装：mc_market action=install-mods refs=["<slug>"]（或 install-plugins 装到服务端）',
        ]
        return { tool: 'mc_market', action: 'search', hits: result.hits, totalHits: result.totalHits, text: lines.join('\n') }
      }

      if (!project) throw new Error('这一步需要工程文件；先 mc_project action=init 或 create')

      if (args.action === 'install-mods') {
        const refs = (args.refs ?? []).filter(Boolean)
        if (!refs.length) throw new Error('install-mods 需要 refs')
        const added = addMods(project, refs)
        await writeProject(file, project)
        const plan = await resolveProject(config, project, exec.signal)
        const lines = [
          `已加入工程：${added.map((mod) => mod.id).join(', ') || '（无变化）'}`,
          `工程模组数：${project.pack.mods.length}`,
          `依赖解析：${plan.entries.length} 项${plan.warnings.length ? `，警告 ${plan.warnings.length}` : '，无警告'}`,
        ]
        if (plan.warnings.length) lines.push('', ...plan.warnings.map((warning) => `- ${warning}`))
        return { tool: 'mc_market', action: 'install-mods', added: added.map((mod) => mod.id), plan: { total: plan.entries.length, warnings: plan.warnings }, text: lines.join('\n') }
      }

      if (args.action === 'install-plugins') {
        const refs = (args.refs ?? []).filter(Boolean)
        if (!refs.length) throw new Error('install-plugins 需要 refs')
        const serverDir = resolvePath(root, project.servers?.mod?.dir ?? 'server/neoforge')
        const pluginLoaders = args.loaders?.length ? args.loaders : ['paper']
        const result = await installServerPlugins(config, {
          refs,
          serverDir,
          gameVersion: gameVersions[0],
          loaders: pluginLoaders,
          overwrite: args.overwrite ?? false,
        }, exec.signal)
        project.servers = project.servers ?? {}
        project.servers.mod = project.servers.mod ?? { kind: project.target.loader, dir: 'server/neoforge' }
        const list = new Set(project.servers.mod.plugins ?? [])
        for (const item of result.installed) list.add(item.ref)
        project.servers.mod.plugins = [...list]
        await writeProject(file, project)
        const lines = [
          `服务端插件目录：${result.serverDir}`,
          `已安装 ${result.installed.filter((item) => item.status === 'installed').length}，已存在 ${result.installed.filter((item) => item.status === 'already-present').length}，失败 ${result.failed.length}`,
          '',
          ...result.installed.map((item) => `- ${item.ref} → ${item.filename}（${item.status}）`),
          ...result.failed.map((item) => `- ${item.ref} 失败：${item.reason}`),
        ]
        return { tool: 'mc_market', action: 'install-plugins', ...result, text: lines.join('\n') }
      }

      // installed
      const serverPlugins = project.servers?.mod?.plugins ?? []
      const lines = [
        `工程模组：${project.pack.mods.length} 个`,
        ...project.pack.mods.map((mod) => `- ${mod.id}${mod.versionId ? `@${mod.versionId}` : ''}`),
        '',
        `服务端插件记录：${serverPlugins.length} 个`,
        ...serverPlugins.map((item) => `- ${item}`),
      ]
      return { tool: 'mc_market', action: 'installed', mods: project.pack.mods, serverPlugins, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_compose — AI pack composition (roles -> candidates -> validate -> apply)
  // ---------------------------------------------------------------------------
  const composeTool = defineTool({
    name: 'mc_compose',
    description:
      'AI 组合整合包：roles 查看角色预设、plan 按角色/主题生成候选方案（自动过滤已在工程里/不匹配版本的项目并落盘到 build/exports/compose/）、apply 应用方案到工程并解析依赖。' +
      'Agent 负责给主题与取舍，工具负责检索、去重、校验与落库。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['roles', 'plan', 'apply'], description: '操作类型' },
        roles: { type: 'array', items: { type: 'string' }, description: '组合角色 id（roles 动作可查看）' },
        perRole: { type: 'integer', minimum: 1, maximum: 12, description: '每个角色取几个候选（默认按角色预设）' },
        theme: { type: 'string', description: '主题关键词，会叠加到每个角色的检索里，例如「幻想 中世纪 魔法」' },
        avoid: { type: 'array', items: { type: 'string' }, description: '排除关键词（slug/标题包含即跳过）' },
        must: { type: 'array', items: { type: 'string' }, description: '必须包含的项目（slug 或 slug@versionId）' },
        plan: { type: 'string', description: 'apply 时使用的方案 id 或路径' },
        refs: { type: 'array', items: { type: 'string' }, description: 'apply 时直接给项目引用（不使用方案文件）' },
        project: { type: 'string', description: '注册表项目 id；省略则使用当前会话工作目录' },
        path: { type: 'string', description: '工程文件路径' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const { root, file } = await projectFileFor(exec, args.path, args.project)
      const planDir = resolvePath(root, 'build/exports/compose')

      if (args.action === 'roles') {
        const rows = composeRoles().map((role) => [role.id, role.label, role.perRole, role.keywords, role.note ?? ''])
        return {
          tool: 'mc_compose',
          action: 'roles',
          roles: composeRoles(),
          text: ['组合角色：', '', formatTable(['id', '角色', '默认数量', '关键词', '说明'], rows), '', '用法：mc_compose action=plan roles=["library","rpg","performance"] theme="幻想 魔法"'].join('\n'),
        }
      }

      const project = await readProject(file).catch(() => undefined)
      if (!project) throw new Error('这一步需要工程文件；先 mc_project action=init 或 create')

      if (args.action === 'plan') {
        const roles = args.roles?.length ? args.roles : composeRoles().map((role) => role.id)
        const { plan, path } = await composePlan(config, {
          project,
          roles,
          perRole: args.perRole,
          theme: args.theme ?? '',
          avoid: args.avoid ?? [],
          must: args.must ?? [],
          planDir,
        }, exec.signal)
        let validation = null
        let validationError = ''
        try {
          const refs = plan.entries.map((entry) => entry.slug)
          if (refs.length) validation = await resolvePlan(config, { refs, gameVersion: project.target.minecraft, loader: project.target.loader, includeOptional: false }, exec.signal)
        } catch (error) {
          validationError = error.message
        }
        const rows = renderPlanTable(plan).map((row, index) => [index + 1, ...row.slice(0, 3), ...row.slice(4)])
        const lines = [
          `AI 组合方案：${plan.id}`,
          `工程：${project.name} | Minecraft ${project.target.minecraft} / ${project.target.loader} | 主题：${args.theme || '（无）'}`,
          `候选 ${plan.entries.length} 项 | 方案文件：${path ?? '（未落盘）'}`,
          '',
          formatTable(['#', '角色', 'slug', '名称', '客户端/服务端', '更新'], rows),
        ]
        if (plan.roleStats.some((stat) => stat.error)) {
          lines.push('', '检索异常：', ...plan.roleStats.filter((stat) => stat.error).map((stat) => `- ${stat.label}：${stat.error}`))
        }
        if (validation) {
          lines.push('', `依赖校验：闭包 ${validation.entries.length} 项，警告 ${validation.warnings.length}`)
          if (validation.warnings.length) lines.push(...validation.warnings.slice(0, 8).map((warning) => `- ${warning}`))
        } else if (validationError) {
          lines.push('', `依赖校验失败：${validationError}`)
        }
        lines.push('', '下一步：mc_compose action=apply plan=<方案 id>，或自行删减后用 mc_mods 增删。')
        return { tool: 'mc_compose', action: 'plan', plan, path, validation: validation ? { total: validation.entries.length, warnings: validation.warnings } : null, text: lines.join('\n') }
      }

      // apply
      let plan
      let refs = args.refs ?? []
      if (args.plan) {
        const loaded = await readComposePlan(planDir, args.plan)
        plan = loaded.plan
        refs = plan.entries.map((entry) => entry.slug)
      }
      if (!refs.length) throw new Error('apply 需要 plan 或 refs')
      const { added } = applyComposition(project, { plan, refs })
      await writeProject(file, project)
      const resolved = await resolveProject(config, project, exec.signal)
      const lines = [
        `已应用组合方案${plan ? `：${plan.id}` : ''}`,
        `新增/更新：${added.map((mod) => mod.id).join(', ') || '（无变化）'}`,
        `工程模组数：${project.pack.mods.length} | 依赖闭包：${resolved.entries.length} 项，警告 ${resolved.warnings.length}`,
      ]
      if (resolved.warnings.length) lines.push('', ...resolved.warnings.map((warning) => `- ${warning}`))
      lines.push('', '下一步：mc_client 定制客户端 → mc_export 导出内容 → mc_build 构建整合包。')
      return { tool: 'mc_compose', action: 'apply', added: added.map((mod) => mod.id), plan: plan?.id, total: resolved.entries.length, warnings: resolved.warnings, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  // ---------------------------------------------------------------------------
  // mc_client — personalized client profile
  // ---------------------------------------------------------------------------
  const clientTool = defineTool({
    name: 'mc_client',
    description:
      '个性化客户端：show 查看当前客户端配置、set 修改（内存/JVM 参数/分辨率/画质/语言/按键等）、add-mods / remove-mods 维护客户端专属模组（构建时会以 client-only 打标）、export 生成 options.txt 与启动器配置（JVM 参数 / 说明）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'set', 'add-mods', 'remove-mods', 'export', 'defaults'], description: '操作类型' },
        patch: { type: 'object', description: 'set 用的部分配置，例如 {"memory":{"max":"8G"},"graphics":{"renderDistance":16}}' },
        refs: { type: 'array', items: { type: 'string' }, description: 'add-mods / remove-mods 的项目引用（slug）' },
        project: { type: 'string', description: '注册表项目 id；省略则使用当前会话工作目录' },
        path: { type: 'string', description: '工程文件路径' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const { root, file } = await projectFileFor(exec, args.path, args.project)

      if (args.action === 'defaults') {
        return { tool: 'mc_client', action: 'defaults', defaults: CLIENT_DEFAULTS, text: `默认客户端配置：\n\n${JSON.stringify(CLIENT_DEFAULTS, null, 2)}` }
      }

      const project = await readProject(file)
      if (args.action === 'show') {
        const profile = clientProfile(project)
        return {
          tool: 'mc_client',
          action: 'show',
          profile,
          text: [
            `客户端配置：${project.name}`,
            `内存：${profile.memory.min} - ${profile.memory.max}`,
            `分辨率：${profile.resolution.width}×${profile.resolution.height}${profile.resolution.fullscreen ? '（全屏）' : ''}`,
            `画质：视距 ${profile.graphics.renderDistance} / 模拟 ${profile.graphics.simulationDistance} / ${profile.graphics.graphicsMode} / 最高帧 ${profile.graphics.maxFps} / VSync ${profile.graphics.vsync} / GUI 缩放 ${profile.graphics.guiScale}`,
            `语言：${profile.language}`,
            `客户端专属模组（${profile.mods.length}）：${profile.mods.join(', ') || '（无）'}`,
            `资源包：${profile.resourcePacks.join(', ') || '（无）'} | 光影：${profile.shaderPacks.join(', ') || '（无）'}`,
            `按键自定义：${Object.keys(profile.keybinds).length} 项`,
            '',
            '原始配置：',
            JSON.stringify(profile, null, 2),
          ].join('\n'),
        }
      }

      if (args.action === 'set') {
        if (!args.patch) throw new Error('set 需要 patch 对象')
        const profile = updateClientProfile(project, args.patch)
        await writeProject(file, project)
        return {
          tool: 'mc_client',
          action: 'set',
          profile,
          text: `已更新客户端配置：${project.name}\n内存 ${profile.memory.min}-${profile.memory.max} | 视距 ${profile.graphics.renderDistance} | 语言 ${profile.language} | 客户端专属模组 ${profile.mods.length} 个`,
        }
      }

      if (args.action === 'add-mods' || args.action === 'remove-mods') {
        const refs = (args.refs ?? []).filter(Boolean)
        if (!refs.length) throw new Error(`${args.action} 需要 refs`)
        const profile = clientProfile(project)
        const set = new Set(profile.mods)
        if (args.action === 'add-mods') for (const ref of refs) set.add(ref)
        else for (const ref of refs) set.delete(ref)
        updateClientProfile(project, { mods: [...set] })
        await writeProject(file, project)
        return {
          tool: 'mc_client',
          action: args.action,
          mods: [...set],
          text: `客户端专属模组（${set.size}）：${[...set].join(', ') || '（无）'}\n这些模组会在 mc_build 时以 client-only（服务端 unsupported）写入 .mrpack。`,
        }
      }

      // export
      const exportDir = resolvePath(root, 'build/exports/client')
      const launcherDir = resolvePath(root, 'build/client')
      const result = await exportClientProfile(project, { exportDir, launcherDir })
      const content = project.pack.content ?? []
      if (!content.some((mapping) => mapping.from === 'build/exports/client')) {
        content.push({ from: 'build/exports/client', to: '', zone: 'overrides', optional: true })
        project.pack.content = content
        await writeProject(file, project)
      }
      const lines = [
        `已导出客户端配置：${project.name}`,
        `随包文件：${exportDir}/options.txt（映射到 overrides/options.txt，首次启动即生效）`,
        `启动器文件：${launcherDir}/jvm-args.txt、client-profile.md`,
        `options.txt 条目：${result.optionCount}`,
        '',
        '构建后 options.txt 会进入 .mrpack 的 overrides/，JVM 参数需要粘到启动器里（见 client-profile.md）。',
      ]
      return { tool: 'mc_client', action: 'export', ...result, text: lines.join('\n') }
    },
    render: (_args, value) => value.text,
  })

  const tools = [
    searchTool,
    resourceTool,
    resolveTool,
    packTool,
    loaderTool,
    serverConfigTool,
    statusTool,
    packCheckTool,
    packInstallTool,
    projectManageTool,
    modsTool,
    designTool,
    exportTool,
    buildTool,
    marketTool,
    composeTool,
    clientTool,
  ]

  for (const tool of tools) ctx.tools.register(tool)

  // ---------------------------------------------------------------------------
  // Web UI manager API (local-only): powers the CraftWorkshop settings pages.
  // ---------------------------------------------------------------------------
  const resolveUiRoot = async () => {
    if (config.defaultOutputRoot) return String(config.defaultOutputRoot)
    if (lastWorkspaceRoot) return lastWorkspaceRoot
    try {
      const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined
      const workspaces = registry?.list?.() ?? []
      for (const workspace of workspaces) {
        try {
          await stat(join(workspace.path, config.projectFile))
          return workspace.path
        } catch {
          /* try the next workspace */
        }
      }
      if (workspaces[0]?.path) return workspaces[0].path
    } catch {
      /* fall through */
    }
    try {
      const workingDirectory = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined
      if (workingDirectory?.defaultDirectory) return workingDirectory.defaultDirectory
    } catch {
      /* fall through */
    }
    return process.cwd()
  }

  registerWebUi(ctx, config, { getRoot: resolveUiRoot, outPath })

}
