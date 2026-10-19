/**
 * Project registry: makes CraftWorkshop a general-purpose authoring tool instead of
 * being bound to one workspace.
 *
 * The registry lives outside any single workspace (default `~/.craft-workshop/projects.json`,
 * configurable through the plugin config) and records every project the tool knows about:
 * its id, display name, root directory, project file and kind. One entry can be marked
 * active, which is what the Web UI opens by default and what tools use when a call names
 * a project explicitly (`project: "<id>"`).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export const REGISTRY_VERSION = 1

export function slugifyProject(text) {
  return (
    String(text ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'project'
  )
}

export function defaultRegistryPath(config = {}) {
  if (config.registryFile) {
    const value = String(config.registryFile)
    return value.startsWith('~') ? join(homedir(), value.slice(1)) : value
  }
  return join(homedir(), '.craft-workshop', 'projects.json')
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Registry handle. Every mutation writes the file atomically enough for a single
 * local process (write temp-free: the file is small and only this plugin writes it).
 */
export function createProjectRegistry(config = {}) {
  const file = defaultRegistryPath(config)
  let cache

  async function load() {
    if (cache) return cache
    const raw = await readJson(file)
    cache = {
      version: REGISTRY_VERSION,
      active: typeof raw?.active === 'string' ? raw.active : '',
      projects: Array.isArray(raw?.projects)
        ? raw.projects
            .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.root === 'string')
            .map((entry) => ({
              id: entry.id,
              name: entry.name || entry.id,
              root: entry.root,
              projectFile: entry.projectFile || 'project.json',
              kind: entry.kind || 'modpack',
              source: entry.source || 'registered',
              createdAt: entry.createdAt || new Date().toISOString(),
              lastOpenedAt: entry.lastOpenedAt || '',
            }))
        : [],
    }
    return cache
  }

  async function save() {
    const data = await load()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    return data
  }

  return {
    file,
    async list() {
      const data = await load()
      return {
        file,
        active: data.active,
        projects: [...data.projects].sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt))),
      }
    },
    async get(id) {
      const data = await load()
      return data.projects.find((entry) => entry.id === id)
    },
    async active() {
      const data = await load()
      return data.projects.find((entry) => entry.id === data.active)
    },
    async touch(id) {
      const data = await load()
      const entry = data.projects.find((item) => item.id === id)
      if (entry) {
        entry.lastOpenedAt = new Date().toISOString()
        await save()
      }
      return entry
    },
    async setActive(id) {
      const data = await load()
      if (id && !data.projects.some((entry) => entry.id === id)) throw new Error(`未注册的项目：${id}`)
      data.active = id || ''
      await save()
      return data.active
    },
    /** Register (or update) a project directory; returns the stored entry. */
    async register({ root, name, projectFile = 'project.json', kind = 'modpack', source = 'registered', activate = false }) {
      if (!root || !isAbsolute(root)) throw new Error('注册项目需要绝对路径 root')
      const data = await load()
      const absolute = resolve(root)
      let entry = data.projects.find((item) => resolve(item.root) === absolute)
      if (entry) {
        entry.name = name || entry.name
        entry.projectFile = projectFile || entry.projectFile
        entry.kind = kind || entry.kind
        entry.source = source
      } else {
        let id = slugifyProject(name || absolute.split('/').filter(Boolean).pop() || 'project')
        let suffix = 2
        while (data.projects.some((item) => item.id === id)) id = `${slugifyProject(name || 'project')}-${suffix++}`
        entry = {
          id,
          name: name || absolute.split('/').filter(Boolean).pop() || id,
          root: absolute,
          projectFile,
          kind,
          source,
          createdAt: new Date().toISOString(),
          lastOpenedAt: new Date().toISOString(),
        }
        data.projects.push(entry)
      }
      if (activate) data.active = entry.id
      await save()
      return entry
    },
    /** Remove a registry entry only — never touches project files. */
    async remove(id) {
      const data = await load()
      const before = data.projects.length
      data.projects = data.projects.filter((entry) => entry.id !== id)
      if (data.active === id) data.active = ''
      await save()
      return { removed: before !== data.projects.length, active: data.active }
    },
  }
}
