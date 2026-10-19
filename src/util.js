/**
 * Shared helpers for the CraftWorkshop plugin.
 * Zero-dependency: Node builtins only, so the bundle can be installed without npm install.
 */

import { createHash } from 'node:crypto'

const CACHE = new Map()

/** Turn low-level fetch failures (DNS, connect timeout) into an actionable message. */
function describeFetchError(error, url) {
  const message = String(error?.message ?? error)
  const cause = error?.cause?.message ?? error?.cause?.code ?? ''
  if (error?.name === 'TypeError' || /fetch failed|connect timeout|ENOTFOUND|EAI_AGAIN/i.test(message + ' ' + cause)) {
    return new Error(`网络请求失败：${url}${cause ? ` — ${cause}` : ''}（请检查本机 DNS / 网络连接）`)
  }
  return error
}

/** Default UA used when the plugin config does not provide one (Modrinth requires a UA). */
export const DEFAULT_USER_AGENT = 'craft-workshop/0.6.0 (https://ipthmc.zyghit.cn)'

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * AbortSignal combining the caller's signal with a timeout. Returns
 * { signal, dispose } so callers can clear the timer after the request.
 */
export function withTimeout(signal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('request timed out')), timeoutMs)
  const forward = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) forward()
    else signal.addEventListener('abort', forward, { once: true })
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', forward)
    },
  }
}

function cacheKeyFor(url) {
  return url
}

/**
 * GET a JSON document with in-memory TTL caching and one retry for transient failures.
 * `config` is the plugin config passed to apply(); `opts.ttlMs` defaults to config.cacheTtlSeconds.
 */
export async function getJson(url, { config = {}, signal, ttlMs, headers = {}, retries = 1, timeoutMs } = {}) {
  const ttl = ttlMs ?? (Number(config.cacheTtlSeconds ?? 600) * 1000)
  const key = cacheKeyFor(url)
  if (ttl > 0) {
    const hit = CACHE.get(key)
    if (hit && hit.expires > Date.now()) return hit.value
    if (hit) CACHE.delete(key)
  }
  const userAgent = headers['User-Agent'] || headers['user-agent'] || config.userAgent || DEFAULT_USER_AGENT
  const budget = timeoutMs ?? Number(config.requestTimeoutMs ?? 20000)
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    const scoped = withTimeout(signal, budget)
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': userAgent, ...headers },
        signal: scoped.signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const error = new Error(`HTTP ${res.status} ${res.statusText} for ${url}${body ? ` — ${body.slice(0, 300)}` : ''}`)
        error.status = res.status
        if (res.status !== 429 && res.status < 500) throw error
        lastError = error
      } else {
        const value = await res.json()
        if (ttl > 0) CACHE.set(key, { value, expires: Date.now() + ttl })
        return value
      }
    } catch (error) {
      lastError = describeFetchError(error, url)
      if (signal?.aborted) throw signal.reason ?? new Error('request aborted')
      if (error?.status && error.status !== 429 && error.status < 500) throw error
    } finally {
      scoped.dispose()
    }
    if (attempt < retries) await sleep(350 * (attempt + 1))
  }
  throw lastError ?? new Error(`request failed: ${url}`)
}

/** GET a text document (XML, YAML, HTML) with the same timeout conventions. */
export async function getText(url, { config = {}, signal, headers = {}, retries = 1, timeoutMs } = {}) {
  const userAgent = headers['User-Agent'] || config.userAgent || DEFAULT_USER_AGENT
  const budget = timeoutMs ?? Number(config.requestTimeoutMs ?? 20000)
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    const scoped = withTimeout(signal, budget)
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': userAgent, ...headers },
        signal: scoped.signal,
      })
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
        error.status = res.status
        if (res.status !== 429 && res.status < 500) throw error
        lastError = error
      } else {
        return await res.text()
      }
    } catch (error) {
      lastError = describeFetchError(error, url)
      if (signal?.aborted) throw signal.reason ?? new Error('request aborted')
      if (error?.status && error.status !== 429 && error.status < 500) throw error
    } finally {
      scoped.dispose()
    }
    if (attempt < retries) await sleep(350 * (attempt + 1))
  }
  throw lastError ?? new Error(`request failed: ${url}`)
}

/** Download bytes (used for server jars and small archives). */
export async function getBytes(url, { config = {}, signal, timeoutMs } = {}) {
  const userAgent = config.userAgent || DEFAULT_USER_AGENT
  const budget = timeoutMs ?? Number(config.requestTimeoutMs ?? 20000)
  const scoped = withTimeout(signal, budget)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: scoped.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    return buffer
  } catch (error) {
    throw describeFetchError(error, url)
  } finally {
    scoped.dispose()
  }
}

/** Approximate display width (CJK counts as two columns). */
export function displayWidth(text) {
  let width = 0
  for (const ch of String(text)) {
    const code = ch.codePointAt(0)
    if (code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x20000 && code <= 0x3fffd))) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

export function truncate(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (displayWidth(value) <= max) return value
  let out = ''
  let width = 0
  for (const ch of value) {
    const w = displayWidth(ch)
    if (width + w > max - 1) break
    out += ch
    width += w
  }
  return `${out}…`
}

/** Render a compact monospace table. Cells may be numbers or strings. */
export function formatTable(headers, rows) {
  const columns = headers.length
  const widths = headers.map((h) => displayWidth(h))
  const normalized = rows.map((row) => {
    const cells = []
    for (let i = 0; i < columns; i++) {
      const cell = row[i] === undefined || row[i] === null ? '' : String(row[i])
      const flat = cell.replace(/\r?\n/g, ' ')
      cells.push(flat)
      widths[i] = Math.max(widths[i], displayWidth(flat))
    }
    return cells
  })
  const pad = (text, width) => `${text}${' '.repeat(Math.max(0, width - displayWidth(text)))}`
  const lines = [headers.map((h, i) => pad(h, widths[i])).join('  ')]
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const cells of normalized) lines.push(cells.map((cell, i) => pad(cell, widths[i])).join('  '))
  return lines.join('\n')
}

export function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '?'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`
}

export function formatDate(iso) {
  if (!iso) return '?'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '?'
  return date.toISOString().slice(0, 10)
}

export function sha1Of(buffer) {
  return createHash('sha1').update(buffer).digest('hex')
}

export function sha512Of(buffer) {
  return createHash('sha512').update(buffer).digest('hex')
}

/** Parse "slug" or "slug@versionId" references. */
export function parseRef(ref) {
  const value = String(ref ?? '').trim()
  const at = value.lastIndexOf('@')
  if (at <= 0) return { id: value, versionId: undefined }
  return { id: value.slice(0, at), versionId: value.slice(at + 1) }
}

export function unique(values) {
  return [...new Set(values)]
}

/** JSON encode for URL query values (Modrinth expects JSON arrays in facets/filters). */
export function queryValue(value) {
  return JSON.stringify(value)
}

export function buildUrl(base, path, params) {
  const url = new URL(path.startsWith('http') ? path : `${base}${path}`)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}
