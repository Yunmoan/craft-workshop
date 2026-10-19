/**
 * Minecraft Java Edition Server List Ping (SLP) over TCP.
 * Implements the handshake + status request/response exchange; no handshake frameworks needed.
 */
import net from 'node:net'
import { resolveSrv } from 'node:dns/promises'

export function writeVarInt(value) {
  if (value < 0) return Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f])
  const bytes = []
  let remaining = value >>> 0
  do {
    let byte = remaining & 0x7f
    remaining >>>= 7
    if (remaining !== 0) byte |= 0x80
    bytes.push(byte)
  } while (remaining !== 0)
  return Buffer.from(bytes)
}

function readVarInt(buffer, offset) {
  let value = 0
  let size = 0
  while (true) {
    if (offset + size >= buffer.length) return null
    const byte = buffer[offset + size]
    value |= (byte & 0x7f) << (7 * size)
    size++
    if ((byte & 0x80) === 0) return { value: value >>> 0, size }
    if (size > 5) throw new Error('VarInt 过长，响应不是合法的 Minecraft 数据包')
  }
}

function packet(parts) {
  const data = Buffer.concat(parts)
  return Buffer.concat([writeVarInt(data.length), data])
}

function stringField(text) {
  const data = Buffer.from(String(text), 'utf8')
  return Buffer.concat([writeVarInt(data.length), data])
}

function uint16(value) {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16BE(value & 0xffff, 0)
  return buffer
}

/** Flatten a Minecraft chat component (1.20.3+ NBT components included) into plain text. */
export function flattenChat(component) {
  if (component === undefined || component === null) return ''
  if (typeof component === 'string') return component
  if (Array.isArray(component)) return component.map(flattenChat).join('')
  if (typeof component !== 'object') return String(component)
  let text = ''
  if (typeof component.text === 'string') text += component.text
  if (typeof component.translate === 'string') text += component.translate
  if (typeof component.with === 'object' && Array.isArray(component.with)) text += flattenChat(component.with)
  if (component.extra !== undefined) text += flattenChat(component.extra)
  if (!text && typeof component.contents === 'string') text += component.contents
  return text
}

function normalizeStatus(status) {
  const version = status.version ?? {}
  const players = status.players ?? {}
  return {
    online: true,
    versionName: version.name ?? '?',
    protocol: version.protocol ?? null,
    playersOnline: players.online ?? 0,
    playersMax: players.max ?? 0,
    samplePlayers: Array.isArray(players.sample) ? players.sample.map((entry) => entry?.name).filter(Boolean) : [],
    motd: flattenChat(status.description).replace(/\u00a7./g, '').trim(),
    hasFavicon: Boolean(status.favicon),
    enforcesSecureChat: status.enforcesSecureChat ?? null,
  }
}

/**
 * Ping one server. Resolves with status fields; rejects on connection/parse failure.
 * @param {{host: string, port?: number, timeoutMs?: number, protocolVersion?: number}} options
 */
export function pingServer({ host, port = 25565, timeoutMs = 5000, protocolVersion = 767 }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const socket = new net.Socket()
    let buffer = Buffer.alloc(0)
    let settled = false
    const timer = setTimeout(() => finish(new Error(`连接超时（${timeoutMs}ms）：${host}:${port}`)), timeoutMs)

    function finish(error, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }

    socket.on('connect', () => {
      try {
        const handshake = packet([
          writeVarInt(0x00),
          writeVarInt(protocolVersion),
          stringField(host),
          uint16(port),
          writeVarInt(1),
        ])
        socket.write(handshake)
        socket.write(Buffer.from([0x01, 0x00]))
      } catch (error) {
        finish(error)
      }
    })

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      try {
        const length = readVarInt(buffer, 0)
        if (!length) return
        if (buffer.length < length.size + length.value) return
        const payload = buffer.subarray(length.size, length.size + length.value)
        let cursor = 0
        const packetId = readVarInt(payload, cursor)
        if (!packetId) return
        cursor += packetId.size
        if (packetId.value !== 0x00) return finish(new Error(`意外的响应数据包 id：${packetId.value}`))
        const jsonLength = readVarInt(payload, cursor)
        if (!jsonLength) return
        cursor += jsonLength.size
        const jsonText = payload.subarray(cursor, cursor + jsonLength.value).toString('utf8')
        let status
        try {
          status = JSON.parse(jsonText)
        } catch {
          return finish(new Error('状态响应不是合法 JSON'))
        }
        finish(null, { ...normalizeStatus(status), latencyMs: Date.now() - startedAt, host, port })
      } catch (error) {
        finish(error)
      }
    })

    socket.on('error', (error) => finish(new Error(`连接 ${host}:${port} 失败：${error.message}`)))
    socket.on('close', () => {
      if (!settled) finish(new Error('连接在收到状态响应前关闭'))
    })
    socket.setNoDelay(true)
    socket.connect(port, host)
  })
}

/**
 * Resolve a Minecraft server's `_minecraft._tcp` SRV record (common for domains whose
 * real server runs on another host/port). Returns undefined when there is no record.
 */
export async function resolveMinecraftSrv(host) {
  const name = String(host ?? '').trim().replace(/\.$/, '')
  if (!name || net.isIP(name)) return undefined
  try {
    const records = await resolveSrv(`_minecraft._tcp.${name}`)
    if (!records?.length) return undefined
    records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)
    const [record] = records
    return {
      host: record.name.replace(/\.$/, ''),
      port: record.port,
      priority: record.priority,
      weight: record.weight,
      records: records.map((item) => ({ host: item.name.replace(/\.$/, ''), port: item.port, priority: item.priority, weight: item.weight })),
    }
  } catch {
    return undefined
  }
}
