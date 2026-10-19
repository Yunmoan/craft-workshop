/**
 * Shared modpack ↔ server consistency check (used by the mc_pack_check tool and the Web UI).
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readMrpack, serverFilesOf } from './mrpack.js'

/**
 * Compare the server side of an .mrpack against a server directory.
 * @returns {Promise<{expected:number, missing:Array, mismatched:Array, extra:Array, ok:boolean}>}
 */
export async function checkPackAgainstServer(packPath, serverDir, { checkHashes = true } = {}) {
  const { index } = await readMrpack(packPath)
  const expected = serverFilesOf(index)
  const missing = []
  const mismatched = []
  for (const file of expected) {
    const absolutePath = join(serverDir, file.path)
    try {
      const info = await stat(absolutePath)
      if (!info.isFile()) throw new Error('not a file')
      if (checkHashes && file.hashes?.sha1) {
        const bytes = await readFile(absolutePath)
        const actual = createHash('sha1').update(bytes).digest('hex')
        if (actual !== file.hashes.sha1) mismatched.push({ path: file.path, expected: file.hashes.sha1, actual })
      }
    } catch {
      const disabled = await stat(`${absolutePath}.disabled`).then(() => true).catch(() => false)
      missing.push({ path: file.path, disabled })
    }
  }
  const expectedPaths = new Set(expected.map((file) => file.path))
  const extra = []
  try {
    const entries = await readdir(join(serverDir, 'mods'), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !/\.jar(\.disabled)?$/i.test(entry.name)) continue
      const relative = `mods/${entry.name}`
      if (!expectedPaths.has(relative) && !expectedPaths.has(`mods/${entry.name.replace(/\.disabled$/i, '')}`)) {
        extra.push(relative)
      }
    }
  } catch {
    /* no mods dir */
  }
  return {
    expected: expected.length,
    missing,
    mismatched,
    extra,
    ok: missing.length === 0 && mismatched.length === 0,
    dependencies: index.dependencies ?? {},
  }
}
