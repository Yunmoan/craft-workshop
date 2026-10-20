/**
 * Personalized client profile: memory/JVM args, resolution, graphics and keybinds are
 * stored in the project file and exported to launcher-side files plus an in-pack
 * `options.txt` (so a fresh instance already feels like "their" client).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const CLIENT_DEFAULTS = {
  displayName: '',
  memory: { min: '4G', max: '8G' },
  jvmArgs: [
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    '-XX:G1NewSizePercent=30',
    '-XX:G1MaxNewSizePercent=40',
    '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dfile.encoding=UTF-8',
  ],
  gameArgs: [],
  resolution: { width: 1920, height: 1080, fullscreen: false },
  graphics: { renderDistance: 12, simulationDistance: 10, graphicsMode: 'fancy', maxFps: 120, vsync: true, guiScale: 3, particles: 'all', entityShadows: true, clouds: true },
  language: 'zh_cn',
  mods: [],
  resourcePacks: [],
  shaderPacks: [],
  keybinds: {},
  options: {},
}

function deepMerge(base, patch) {
  if (patch === undefined || patch === null) return base
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = key in base && typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key]) ? deepMerge(base[key], value) : value
  }
  return out
}

export function clientProfile(project) {
  return deepMerge(CLIENT_DEFAULTS, project.client ?? {})
}

export function updateClientProfile(project, patch) {
  project.client = deepMerge(clientProfile(project), patch ?? {})
  return project.client
}

function optionLines(profile) {
  const lines = []
  const push = (key, value) => {
    if (value === undefined || value === null || value === '') return
    if (typeof value === 'boolean') lines.push(`${key}:${value}`)
    else lines.push(`${key}:${value}`)
  }
  push('lang', profile.language)
  push('renderDistance', profile.graphics.renderDistance)
  push('simulationDistance', profile.graphics.simulationDistance)
  push('graphicsMode', profile.graphics.graphicsMode)
  push('maxFps', profile.graphics.maxFps)
  push('vsync', profile.graphics.vsync)
  push('guiScale', profile.graphics.guiScale)
  push('particles', profile.graphics.particles)
  push('entityShadows', profile.graphics.entityShadows)
  push('clouds', profile.graphics.clouds)
  push('fullscreen', profile.resolution.fullscreen)
  for (const [key, value] of Object.entries(profile.options ?? {})) push(key, value)
  for (const [key, value] of Object.entries(profile.keybinds ?? {})) push(key, value)
  return lines
}

/**
 * Export the client profile:
 *  - `exportDir/options.txt`      → shipped into the pack (overrides/options.txt)
 *  - `launcherDir/jvm-args.txt`   → launcher JVM arguments (memory included)
 *  - `launcherDir/client-profile.md` → human instructions
 */
export async function exportClientProfile(project, { exportDir, launcherDir }) {
  const profile = clientProfile(project)
  const files = []
  await mkdir(exportDir, { recursive: true })
  await mkdir(launcherDir, { recursive: true })

  const optionsPath = join(exportDir, 'options.txt')
  await writeFile(optionsPath, `${optionLines(profile).join('\n')}\n`, 'utf8')
  files.push(optionsPath)

  const memory = `-Xms${profile.memory.min} -Xmx${profile.memory.max}`
  const jvmPath = join(launcherDir, 'jvm-args.txt')
  await writeFile(jvmPath, `${memory} ${profile.jvmArgs.join(' ')}\n`, 'utf8')
  files.push(jvmPath)

  const md = [
    `# ${project.name} · 客户端配置`,
    '',
    `- 内存：${profile.memory.min} - ${profile.memory.max}`,
    `- 分辨率：${profile.resolution.width}×${profile.resolution.height}${profile.resolution.fullscreen ? '（全屏）' : ''}`,
    `- 画质：视距 ${profile.graphics.renderDistance} / 模拟距离 ${profile.graphics.simulationDistance} / ${profile.graphics.graphicsMode} / 最高帧 ${profile.graphics.maxFps} / VSync ${profile.graphics.vsync}`,
    `- 语言：${profile.language}`,
    `- 客户端专属模组：${profile.mods.length ? profile.mods.join(', ') : '（无）'}`,
    `- 资源包：${profile.resourcePacks.length ? profile.resourcePacks.join(', ') : '（无）'}`,
    `- 光影：${profile.shaderPacks.length ? profile.shaderPacks.join(', ') : '（无）'}`,
    '',
    '## 启动器设置（JVM 参数）',
    '',
    '```',
    `${memory} ${profile.jvmArgs.join(' ')}`,
    '```',
    '',
    '> 上面这行已写入同目录的 `jvm-args.txt`，粘到启动器（Prism / HMCL / Modrinth App）的 JVM 参数即可。',
    '',
    '## 游戏内设置',
    '',
    '`options.txt` 会随整合包放进实例根目录（`overrides/options.txt`），首次启动即生效；',
    '进入游戏后还可按需调整，游戏保存时会覆盖该文件。',
    '',
    profile.keybinds && Object.keys(profile.keybinds).length ? `## 按键\n\n\`\`\`\n${JSON.stringify(profile.keybinds, null, 2)}\n\`\`\`` : '',
    '',
  ].filter(Boolean).join('\n')
  const mdPath = join(launcherDir, 'client-profile.md')
  await writeFile(mdPath, md, 'utf8')
  files.push(mdPath)

  return { exportDir, launcherDir, files, optionCount: optionLines(profile).length, profile }
}
