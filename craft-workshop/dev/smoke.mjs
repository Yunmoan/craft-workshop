/**
 * Local smoke test for the CraftWorkshop plugin modules.
 * Run: node dev/smoke.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchProjects, resolvePlan } from '../src/modrinth.js'
import { loaderInfo } from '../src/loaders.js'
import { buildMrpack, readMrpack, serverFilesOf } from '../src/mrpack.js'
import { generateServerConfig } from '../src/servercfg.js'
import { pingServer } from '../src/ping.js'
import { createZip, readZip } from '../src/zip.js'

const config = {
  userAgent: 'craft-workshop-smoke/0.4.0 (https://ipthmc.zyghit.cn)',
  defaultGameVersion: '1.21.1',
  defaultLoader: 'neoforge',
  cacheTtlSeconds: 0,
  requestTimeoutMs: 30000,
  maxDependencyDepth: 6,
}
const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const work = await mkdtemp(join(tmpdir(), 'ipthmc-smoke-'))
try {
  // 1. zip roundtrip
  const archive = createZip([
    { name: 'a/b.txt', data: 'hello 世界' },
    { name: 'c.bin', data: Buffer.from([1, 2, 3, 4, 5]), compress: false },
  ])
  const roundtrip = readZip(archive)
  check('zip roundtrip', roundtrip.get('a/b.txt')?.toString() === 'hello 世界' && roundtrip.get('c.bin')?.length === 5)

  // 2. Modrinth search
  const search = await searchProjects(config, {
    query: 'sodium',
    projectType: 'mod',
    loaders: ['neoforge'],
    gameVersions: ['1.21.1'],
    limit: 3,
  })
  check('modrinth search', search.hits.length > 0, `${search.totalHits} hits, first=${search.hits[0]?.slug}`)

  // 3. loader metadata
  const neoforge = await loaderInfo(config, { kind: 'neoforge', gameVersion: '1.21.1', limit: 3 })
  check('neoforge versions', neoforge.items[0]?.version?.startsWith('21.1.'), neoforge.items[0]?.version)
  const paper = await loaderInfo(config, { kind: 'paper', gameVersion: '1.21.1', limit: 2 })
  check('paper builds', Boolean(paper.items[0]?.url), paper.items[0]?.version)
  const arclight = await loaderInfo(config, { kind: 'arclight', gameVersion: '1.21.1', limit: 2 })
  check('arclight builds', Boolean(arclight.items[0]?.url), arclight.items[0]?.version)
  const forge = await loaderInfo(config, { kind: 'forge', gameVersion: '1.21.1', limit: 3 })
  check('forge versions', Boolean(forge.items[0]?.url), `${forge.items[0]?.version} (${forge.items[0]?.channel})`)
  const fabric = await loaderInfo(config, { kind: 'fabric', gameVersion: '1.21.1', limit: 3 })
  check('fabric loaders', Boolean(fabric.items[0]?.serverJarUrl), `recommended=${fabric.recommended}`)

  // 4. dependency resolution (sodium + a known dependency graph)
  const plan = await resolvePlan(config, { refs: ['sodium', 'lithium'], gameVersion: '1.21.1', loader: 'neoforge' })
  check('resolve plan', plan.entries.length >= 2, `${plan.entries.length} entries, warnings=${plan.warnings.length}`)

  // 5. mrpack build + read back
  const packPath = join(work, 'ipthmc-test.mrpack')
  const pack = await buildMrpack(config, {
    name: 'IPTHMC Smoke Pack',
    versionId: '0.1.0-smoke',
    summary: 'smoke test',
    projects: ['sodium', 'lithium'],
    gameVersion: '1.21.1',
    loader: 'neoforge',
    outputPath: packPath,
  })
  const reopened = await readMrpack(packPath)
  check(
    'mrpack build',
    reopened.index.formatVersion === 1 && reopened.index.files.length === pack.files && reopened.index.dependencies.minecraft === '1.21.1',
    `${pack.files} files, deps=${JSON.stringify(reopened.index.dependencies)}`,
  )

  // 6. server config generation (paper + velocity + neoforge)
  const paperDir = join(work, 'server-paper')
  const paperConfig = await generateServerConfig(config, {
    kind: 'paper',
    dir: paperDir,
    downloadJar: true,
    settings: { motd: '§6永世幻想间 §7测试', port: 25566, maxPlayers: 30, java: { minMemory: '2G', maxMemory: '4G' } },
  })
  check('paper config', paperConfig.files.some((file) => file.path === 'server.properties') && paperConfig.files.some((file) => file.path.startsWith('paper-1.21.1')), `${paperConfig.files.length} files`)
  const velocityDir = join(work, 'proxy-velocity')
  const velocityConfig = await generateServerConfig(config, {
    kind: 'velocity',
    dir: velocityDir,
    settings: { proxy: { enabled: true, velocityPort: 25577, lobbyAddress: '127.0.0.1:25566' } },
  })
  check('velocity config', velocityConfig.files.some((file) => file.path === 'velocity.toml'), `${velocityConfig.files.length} files`)
  const neoDir = join(work, 'server-neoforge')
  const neoConfig = await generateServerConfig(config, { kind: 'neoforge', dir: neoDir, settings: {} })
  check('neoforge config', neoConfig.files.some((file) => file.path === 'user_jvm_args.txt'), `${neoConfig.files.length} files`)
  // server.properties must drop pvp/enable-command-block for 1.21.9+ targets
  const modernProps = (await import('../src/servercfg.js')).serverProperties((await import('../src/servercfg.js')).DEFAULT_SETTINGS, '26.3')
  const legacyProps = (await import('../src/servercfg.js')).serverProperties((await import('../src/servercfg.js')).DEFAULT_SETTINGS, '1.21.1')
  check('server.properties version branch', !/^pvp=/m.test(modernProps) && /^pvp=/m.test(legacyProps), '1.21.1 keeps pvp, 26.3 drops it')

  // 7. server list ping against a public server
  try {
    const status = await pingServer({ host: 'play.originrealms.com', port: 25565, timeoutMs: 8000 })
    check('server list ping', status.online === true, `${status.versionName}, ${status.playersOnline}/${status.playersMax}, ${status.latencyMs}ms, motd=${status.motd.slice(0, 40)}`)
  } catch (error) {
    check('server list ping', false, error.message)
  }

  console.log(`\nWORKDIR: ${work}`)
  const failed = results.filter((result) => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} finally {
  // keep the artifacts for inspection on failure; clean only when everything passed
  if (!process.exitCode) await rm(work, { recursive: true, force: true })
}
