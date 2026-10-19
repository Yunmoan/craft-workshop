/**
 * CraftWorkshop Web UI — manager pages in the DSH settings panel:
 * 概览 / 模组 / 设计内容 / 构建导出 / 服务器.
 *
 * Data and actions come from the Host half's local-only manager API
 * (`/craft-workshop/api/*`). Rendering follows Harness UI rules: React from the
 * module table, theme tokens only, no DOM outside the component, and no imports
 * of Harness Client packages.
 */
window.__ModuleLoader__.load({
  id: '@ipthmc/craft-workshop-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/craft-workshop/api'

    const KIND_LABELS = {
      character: '人物',
      faction: '势力',
      location: '地点',
      lore: '世界观',
      story_chapter: '剧情',
      quest_chapter: '任务',
      item: '物品',
      recipe: '配方',
    }
    const KIND_ORDER = ['character', 'faction', 'location', 'lore', 'story_chapter', 'quest_chapter', 'item', 'recipe']
    const EXPORT_LABELS = { 'design-wiki': '设计文档', ftbquests: 'FTB Quests', patchouli: 'Patchouli 指南书', kubejs: 'KubeJS' }

    const DESIGN_TEMPLATES = {
      character: { name: '新人物' },
      faction: { name: '新势力' },
      location: { name: '新地点' },
      lore: { title: '新世界观条目' },
      story_chapter: { title: '新剧情章节', order: 1 },
      quest_chapter: { title: '新任务章节', order: 1, quests: [] },
      item: { name: '新物品' },
      recipe: { name: '新配方', type: 'shaped', pattern: [], key: {}, output: '', count: 1 },
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    async function api(path, options) {
      const init = { method: options && options.method ? options.method : 'GET', cache: 'no-store' }
      if (options && options.body !== undefined) {
        init.headers = { 'Content-Type': 'application/json' }
        init.body = JSON.stringify(options.body)
      }
      const response = await fetch(window.location.origin + API + path, init)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + response.status)
      return data
    }

    function formatBytes(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value < 0) return '?'
      if (value < 1024) return value + ' B'
      if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB'
      return (value / 1024 / 1024).toFixed(1) + ' MiB'
    }

    function formatTime(iso) {
      if (!iso) return '?'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return '?'
      const pad = (number) => String(number).padStart(2, '0')
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    function useProjectState() {
      const [state, setState] = React.useState({ phase: 'loading' })
      const [version, setVersion] = React.useState(0)
      React.useEffect(() => {
        let cancelled = false
        api('/state')
          .then((data) => {
            if (!cancelled) setState({ phase: 'ready', data })
          })
          .catch((error) => {
            if (!cancelled) setState({ phase: 'error', error: error.message })
          })
        return () => {
          cancelled = true
        }
      }, [version])
      return [state, () => setVersion((value) => value + 1)]
    }

    // ---------------------------------------------------------------------
    // Shared atoms
    // ---------------------------------------------------------------------
    function Logo() {
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: 36, height: 36, 'aria-hidden': true, className: 'cw-logo' },
        h('rect', { width: 64, height: 64, rx: 14, fill: '#1d352b' }),
        h('path', { d: 'M32 13 51 22.5 32 32 13 22.5Z', fill: '#4ec56a' }),
        h('path', { d: 'M13 22.5 32 32 32 51 13 41.5Z', fill: '#2f6f3e' }),
        h('path', { d: 'M51 22.5 32 32 32 51 51 41.5Z', fill: '#224d2f' }),
        h('path', { d: 'M38.5 40.5 48.5 50.5', stroke: '#7a4a1f', strokeWidth: 3.4, strokeLinecap: 'round' }),
        h('path', { d: 'M35.5 36.2c3.6-3.8 8.8-5.6 14.2-4.2-3.2-5.6-8.6-8.6-14.6-8.1 1.9 4.1 2 8.2.4 12.3Z', fill: '#e8bf5a' }),
      )
    }

    function Badge(props) {
      return h('span', { className: 'cw-badge ' + (props.tone ? 'cw-badge-' + props.tone : '') }, props.children)
    }

    function Card(props) {
      return h(
        'section',
        { className: 'cw-card' },
        props.title
          ? h(
              'div',
              { className: 'cw-card-head' },
              h('h3', { className: 'cw-card-title' }, props.title),
              props.extra ? h('div', { className: 'cw-card-extra' }, props.extra) : null,
            )
          : null,
        props.children,
      )
    }

    function Stat(props) {
      return h(
        'div',
        { className: 'cw-stat' },
        h('div', { className: 'cw-stat-value ' + (props.tone ? 'cw-tone-' + props.tone : '') }, props.value),
        h('div', { className: 'cw-stat-label' }, props.label),
        props.hint ? h('div', { className: 'cw-stat-hint' }, props.hint) : null,
      )
    }

    function Button(props) {
      return h(
        'button',
        {
          type: 'button',
          className:
            'cw-button ' + (props.primary ? 'cw-button-primary ' : '') + (props.danger ? 'cw-button-danger ' : '') + (props.className || ''),
          disabled: props.disabled || props.busy,
          onClick: props.onClick,
          title: props.title,
        },
        props.busy ? props.busyText || '处理中…' : props.children,
      )
    }

    function Input(props) {
      return h('input', {
        className: 'cw-input ' + (props.className || ''),
        value: props.value,
        placeholder: props.placeholder,
        onChange: (event) => props.onChange(event.target.value),
        disabled: props.disabled,
        'aria-label': props['aria-label'] || props.placeholder,
      })
    }

    function Note(props) {
      return h('p', { className: 'cw-note ' + (props.tone ? 'cw-note-' + props.tone : '') }, props.children)
    }

    function PageFrame(props) {
      return h(
        'div',
        { className: 'cw-root' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'cw-header' },
          h(Logo),
          h('div', { className: 'cw-header-text' }, h('h2', { className: 'cw-title' }, props.title), h('p', { className: 'cw-subtitle' }, props.subtitle)),
          props.refresh ? h(Button, { onClick: props.refresh, busy: props.busy, busyText: '刷新中…' }, '刷新') : null,
        ),
        props.children,
      )
    }

    function StateView(state, retry) {
      if (state.phase === 'loading') return h(Note, null, '正在读取工程数据…')
      if (state.phase === 'error') {
        return h(Card, { title: '读取失败' }, h(Note, { tone: 'error' }, state.error), h(Button, { onClick: retry }, '重试'))
      }
      return null
    }

    // ---------------------------------------------------------------------
    // 概览
    // ---------------------------------------------------------------------
    function OverviewPage() {
      const [state, refresh] = useProjectState()
      const [busy, setBusy] = React.useState('')
      const [message, setMessage] = React.useState(null)
      const data = state.data
      const project = data && data.project
      const design = (data && data.design) || { total: 0, totals: {}, errors: [], warnings: [], ok: true }
      const builds = (data && data.builds) || []
      const buildsTotal = (data && data.buildsTotal) || 0
      const exportsInfo = (data && data.exports) || {}
      const history = (data && data.history) || []

      async function act(name, runner) {
        setBusy(name)
        setMessage(null)
        try {
          const text = await runner()
          setMessage({ tone: 'success', text })
          refresh()
        } catch (error) {
          setMessage({ tone: 'error', text: error.message })
        } finally {
          setBusy('')
        }
      }

      const body = StateView(state, refresh)
      return h(
        PageFrame,
        { title: '方块工坊 · 概览', subtitle: '整合包创作面板 · 工程 / 设计内容 / 导出 / 构建', refresh, busy: state.phase === 'refreshing' },
        body,
        data && data.hasProject
          ? h(
              React.Fragment,
              null,
              h(
                Card,
                { title: '工程', extra: h(Badge, { tone: 'brand' }, 'v' + project.versionId) },
                h('div', { className: 'cw-project-name' }, project.name),
                h('div', { className: 'cw-project-meta' }, project.id + ' · ' + data.workspaceRoot),
                h(
                  'div',
                  { className: 'cw-badges' },
                  h(Badge, { tone: 'brand' }, 'Minecraft ' + project.target.minecraft),
                  h(Badge, null, project.target.loader + (project.target.loaderVersion ? ' ' + project.target.loaderVersion : '')),
                  project.website ? h(Badge, null, project.website) : null,
                ),
                project.summary ? h(Note, null, project.summary) : null,
              ),
              h(
                'div',
                { className: 'cw-stats' },
                h(Stat, { value: project.modsCount, label: '模组', hint: project.pinnedCount ? project.pinnedCount + ' 个已锁定版本' : '全部跟随最新版' }),
                h(Stat, { value: design.total, label: '设计内容', hint: design.ok ? '校验通过' : '存在问题', tone: design.ok ? 'success' : 'warn' }),
                h(Stat, { value: buildsTotal, label: '构建产物', hint: builds[0] ? formatTime(builds[0].modified) : '还没有构建' }),
                h(Stat, {
                  value: data.serverMods === null ? '—' : data.serverMods,
                  label: '服务端 mods',
                  hint: 'server/neoforge/mods',
                }),
              ),
              h(
                Card,
                { title: '快捷操作', extra: h(Badge, null, '操作会直接写工程/产物') },
                h(
                  'div',
                  { className: 'cw-actions' },
                  h(
                    Button,
                    {
                      primary: true,
                      busy: busy === 'export',
                      onClick: () =>
                        act('export', async () => {
                          const result = await api('/export', { method: 'POST', body: { target: 'all' } })
                          const ok = result.results.filter((item) => item.ok).length
                          return '导出完成：' + ok + '/' + result.results.length + ' 个目标成功'
                        }),
                    },
                    '导出全部',
                  ),
                  h(
                    Button,
                    {
                      primary: true,
                      busy: busy === 'build',
                      onClick: () =>
                        act('build', async () => {
                          const result = await api('/build', { method: 'POST', body: {} })
                          return '构建完成：' + result.outputPath + '（' + formatBytes(result.size) + '，' + result.files + ' 个 mod）'
                        }),
                    },
                    '构建整合包',
                  ),
                ),
                message ? h(Note, { tone: message.tone }, message.text) : null,
              ),
              h(
                Card,
                {
                  title: '设计内容',
                  extra: h(Badge, { tone: design.ok ? 'success' : 'warn' }, design.ok ? '校验通过' : design.errors.length + ' 个错误'),
                },
                h(
                  'div',
                  { className: 'cw-chips' },
                  KIND_ORDER.map((kind) =>
                    h('span', { key: kind, className: 'cw-chip' }, KIND_LABELS[kind], h('b', null, ' ' + (design.totals[kind] || 0))),
                  ),
                ),
                design.errors && design.errors.length
                  ? h('ul', { className: 'cw-list cw-error-list' }, design.errors.slice(0, 5).map((text, index) => h('li', { key: index }, text)))
                  : null,
                design.warnings && design.warnings.length
                  ? h('ul', { className: 'cw-list cw-warn-list' }, design.warnings.slice(0, 4).map((text, index) => h('li', { key: index }, text)))
                  : null,
              ),
              h(
                Card,
                { title: '导出状态' },
                h(
                  'table',
                  { className: 'cw-table' },
                  h(
                    'tbody',
                    null,
                    Object.keys(EXPORT_LABELS).map((target) => {
                      const info = exportsInfo[target] || { present: false, files: 0 }
                      return h(
                        'tr',
                        { key: target },
                        h('td', { className: 'cw-table-label' }, EXPORT_LABELS[target]),
                        h('td', null, h(Badge, { tone: info.present ? 'success' : 'idle' }, info.present ? info.files + ' 个文件' : '未导出')),
                        h('td', { className: 'cw-table-hint' }, 'build/exports/' + target),
                      )
                    }),
                  ),
                ),
              ),
              h(
                Card,
                { title: '最近构建' },
                builds.length
                  ? h(
                      'table',
                      { className: 'cw-table' },
                      h(
                        'tbody',
                        null,
                        builds.map((build) =>
                          h(
                            'tr',
                            { key: build.name },
                            h('td', { className: 'cw-table-label' }, build.name),
                            h('td', null, formatBytes(build.size)),
                            h('td', { className: 'cw-table-hint' }, formatTime(build.modified)),
                          ),
                        ),
                      ),
                    )
                  : h(Note, null, '还没有 .mrpack；点上方「构建整合包」。'),
              ),
              history.length
                ? h(
                    Card,
                    { title: '操作历史' },
                    h(
                      'table',
                      { className: 'cw-table' },
                      h(
                        'tbody',
                        null,
                        history.slice(0, 8).map((item, index) =>
                          h(
                            'tr',
                            { key: index },
                            h('td', { className: 'cw-table-label' }, item.action + (item.target ? ' · ' + item.target : '')),
                            h('td', null, h(Badge, { tone: item.ok ? 'success' : 'warn' }, item.ok ? '成功' : '失败')),
                            h('td', { className: 'cw-table-hint' }, formatTime(item.time)),
                          ),
                        ),
                      ),
                    ),
                  )
                : null,
            )
          : data
            ? h(Card, { title: '还没有工程文件' }, h(Note, null, '在会话里让 Agent 运行 mc_project action=init，或确认 DSH 会话工作目录指向项目根目录。'))
            : null,
      )
    }

    // ---------------------------------------------------------------------
    // 模组管理器
    // ---------------------------------------------------------------------
    function ModsPage() {
      const [state, refresh] = useProjectState()
      const [data, setData] = React.useState({ phase: 'loading' })
      const [version, setVersion] = React.useState(0)
      const [ref, setRef] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [message, setMessage] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        setData((previous) => ({ phase: previous.plan ? 'refreshing' : 'loading', plan: previous.plan, mods: previous.mods }))
        api('/mods?resolve=1')
          .then((result) => {
            if (!cancelled) setData({ phase: 'ready', mods: result.mods || [], plan: result.plan || [], warnings: result.warnings || [] })
          })
          .catch((error) => {
            if (!cancelled) setData({ phase: 'error', error: error.message })
          })
        return () => {
          cancelled = true
        }
      }, [version])

      const project = state.data && state.data.project
      const detailed = (state.data && state.data.modsDetailed) || []
      const pinned = new Map(detailed.map((mod) => [mod.id, mod.versionId]))
      const plan = data.plan || []
      const planById = new Map(plan.filter((entry) => entry.direct).map((entry) => [entry.id, entry]))

      async function act(name, runner, successText) {
        setBusy(name)
        setMessage(null)
        try {
          const result = await runner()
          setMessage({ tone: 'success', text: typeof successText === 'function' ? successText(result) : successText })
          setVersion((value) => value + 1)
          refresh()
        } catch (error) {
          setMessage({ tone: 'error', text: error.message })
        } finally {
          setBusy('')
        }
      }

      const rows =
        data.mods && data.mods.length
          ? data.mods.map((mod) => {
              const id = typeof mod === 'string' ? mod : mod.id
              const locked = typeof mod === 'string' ? pinned.get(id) : mod.versionId
              const entry = planById.get(id)
              return h(
                'tr',
                { key: id },
                h('td', { className: 'cw-table-label' }, id),
                h('td', null, entry ? entry.title : '—'),
                h('td', null, entry ? entry.version : locked || '最新'),
                h('td', null, entry ? entry.clientSide + '/' + entry.serverSide : '—'),
                h(
                  'td',
                  { className: 'cw-table-actions' },
                  locked
                    ? h(
                        Button,
                        { onClick: () => act('unpin:' + id, () => api('/mods', { method: 'POST', body: { action: 'unpin', refs: [id] } }), '已取消锁定 ' + id) },
                        '解锁',
                      )
                    : null,
                  h(
                    Button,
                    { danger: true, onClick: () => act('remove:' + id, () => api('/mods', { method: 'POST', body: { action: 'remove', refs: [id] } }), '已移除 ' + id) },
                    '移除',
                  ),
                ),
              )
            })
          : null

      return h(
        PageFrame,
        {
          title: '方块工坊 · 模组管理器',
          subtitle: '编辑 project.json 的模组清单：添加/移除/锁定，自动解析依赖',
          refresh,
          busy: state.phase === 'refreshing',
        },
        h(
          Card,
          { title: '添加模组', extra: h(Badge, null, project ? project.modsCount + ' 个' : '') },
          h(
            'div',
            { className: 'cw-form-row' },
            h(Input, { value: ref, onChange: setRef, placeholder: 'Modrinth slug 或 slug@versionId，例如 create 或 create@VERSION_ID' }),
            h(
              Button,
              {
                primary: true,
                busy: busy === 'add',
                onClick: () =>
                  act(
                    'add',
                    async () => {
                      const result = await api('/mods', { method: 'POST', body: { action: 'add', refs: [ref.trim()] } })
                      setRef('')
                      return result
                    },
                    (result) => '已添加/更新：' + (result.changed.length ? result.changed.join(', ') : '（无变化）'),
                  ),
              },
              '添加',
            ),
            h(Button, { onClick: () => setVersion((value) => value + 1), busy: data.phase === 'refreshing' }, '解析依赖'),
          ),
          message ? h(Note, { tone: message.tone }, message.text) : null,
        ),
        h(
          Card,
          { title: '模组清单' },
          data.phase === 'loading'
            ? h(Note, null, '正在解析依赖（需要联网）…')
            : data.phase === 'error'
              ? h(Note, { tone: 'error' }, data.error)
              : rows
                ? h(
                    'table',
                    { className: 'cw-table cw-table-wide' },
                    h('thead', null, h('tr', null, ['模组', '名称', '版本', '客户端/服务端', ''].map((text) => h('th', { key: text }, text)))),
                    h('tbody', null, rows),
                  )
                : h(Note, null, '还没有模组；在上方输入 slug 添加。'),
          data.warnings && data.warnings.length
            ? h('ul', { className: 'cw-list cw-warn-list' }, data.warnings.map((text, index) => h('li', { key: index }, text)))
            : null,
        ),
      )
    }

    // ---------------------------------------------------------------------
    // 设计内容管理器
    // ---------------------------------------------------------------------
    function DesignPage() {
      const [state, refresh] = useProjectState()
      const [kind, setKind] = React.useState('character')
      const [list, setList] = React.useState({ phase: 'idle', entries: [] })
      const [id, setId] = React.useState('')
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [message, setMessage] = React.useState(null)
      const [check, setCheck] = React.useState(null)

      function loadList(nextKind) {
        setList({ phase: 'loading', entries: [] })
        api('/design?kind=' + encodeURIComponent(nextKind))
          .then((result) => setList({ phase: 'ready', entries: result.entries || [] }))
          .catch((error) => setList({ phase: 'error', error: error.message, entries: [] }))
      }

      React.useEffect(() => {
        loadList(kind)
      }, [kind])

      function openEntry(entryId) {
        api('/design?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(entryId))
          .then((result) => {
            setId(entryId)
            setText(JSON.stringify(result.entry.data, null, 2))
            setMessage(null)
          })
          .catch((error) => setMessage({ tone: 'error', text: error.message }))
      }

      function newEntry() {
        const generated = window.prompt('新条目 id（字母/数字/汉字/点/下划线/中划线）', kind + '-' + String(Date.now()).slice(-6))
        if (!generated) return
        const data = Object.assign({ id: generated.trim() }, DESIGN_TEMPLATES[kind] || {})
        setId(generated.trim())
        setText(JSON.stringify(data, null, 2))
        setMessage(null)
      }

      async function save() {
        setBusy('save')
        setMessage(null)
        try {
          let data
          try {
            data = JSON.parse(text)
          } catch (error) {
            throw new Error('JSON 解析失败：' + error.message)
          }
          const result = await api('/design', { method: 'POST', body: { action: 'write', kind, id, data } })
          const problems = (result.validation && result.validation.errors ? result.validation.errors : []).concat(result.relevant || [])
          setMessage({
            tone: problems.length ? 'warn' : 'success',
            text: problems.length ? '已保存，但存在校验问题：' + problems.join('；') : '已保存 ' + kind + '/' + id,
          })
          loadList(kind)
          refresh()
        } catch (error) {
          setMessage({ tone: 'error', text: error.message })
        } finally {
          setBusy('')
        }
      }

      async function remove() {
        if (!id) return
        if (!window.confirm('确认删除 ' + kind + '/' + id + '？')) return
        setBusy('delete')
        try {
          await api('/design', { method: 'POST', body: { action: 'delete', kind, id } })
          setMessage({ tone: 'success', text: '已删除 ' + kind + '/' + id })
          setId('')
          setText('')
          loadList(kind)
          refresh()
        } catch (error) {
          setMessage({ tone: 'error', text: error.message })
        } finally {
          setBusy('')
        }
      }

      async function runCheck() {
        setBusy('check')
        try {
          const result = await api('/design', { method: 'POST', body: { action: 'check' } })
          setCheck(result)
          setMessage({ tone: result.ok ? 'success' : 'warn', text: result.ok ? '全量校验通过' : '发现 ' + result.errors.length + ' 个错误' })
        } catch (error) {
          setMessage({ tone: 'error', text: error.message })
        } finally {
          setBusy('')
        }
      }

      const entries = list.entries || []
      return h(
        PageFrame,
        {
          title: '方块工坊 · 设计管理器',
          subtitle: '剧情 / 任务 / 人物 / 势力 / 地点 / 世界观 / 物品 / 配方',
          refresh,
          busy: state.phase === 'refreshing',
        },
        h(
          'div',
          { className: 'cw-kind-row' },
          KIND_ORDER.map((item) =>
            h('button', { key: item, type: 'button', className: 'cw-kind ' + (item === kind ? 'cw-kind-active' : ''), onClick: () => setKind(item) }, KIND_LABELS[item]),
          ),
        ),
        h(
          'div',
          { className: 'cw-split' },
          h(
            Card,
            { title: KIND_LABELS[kind] + '列表', extra: h(Button, { onClick: newEntry }, '新建') },
            list.phase === 'loading'
              ? h(Note, null, '正在读取…')
              : list.phase === 'error'
                ? h(Note, { tone: 'error' }, list.error)
                : entries.length
                  ? h(
                      'ul',
                      { className: 'cw-entry-list' },
                      entries.map((entry) =>
                        h(
                          'li',
                          { key: entry.id, className: 'cw-entry ' + (entry.id === id ? 'cw-entry-active' : ''), onClick: () => openEntry(entry.id) },
                          h('b', null, entry.title || entry.id),
                          h('span', null, entry.id),
                        ),
                      ),
                    )
                  : h(Note, null, '还没有条目，点「新建」。'),
          ),
          h(
            Card,
            { title: id ? '编辑 ' + kind + '/' + id : '编辑区', extra: h(Button, { onClick: runCheck, busy: busy === 'check' }, '全量校验') },
            h('textarea', {
              className: 'cw-textarea',
              value: text,
              placeholder: '从左侧选择条目，或点「新建」',
              onChange: (event) => setText(event.target.value),
              spellCheck: false,
            }),
            h(
              'div',
              { className: 'cw-actions' },
              h(Button, { primary: true, onClick: save, busy: busy === 'save', disabled: !id || !text.trim() }, '保存'),
              h(Button, { danger: true, onClick: remove, busy: busy === 'delete', disabled: !id }, '删除'),
            ),
            message ? h(Note, { tone: message.tone }, message.text) : null,
            check
              ? h(
                  'div',
                  { className: 'cw-check' },
                  h('div', null, '校验：' + (check.ok ? '通过' : check.errors.length + ' 个错误') + '，共 ' + check.total + ' 条内容'),
                  check.errors.length
                    ? h('ul', { className: 'cw-list cw-error-list' }, check.errors.slice(0, 8).map((item, index) => h('li', { key: index }, item)))
                    : null,
                  check.warnings.length
                    ? h('ul', { className: 'cw-list cw-warn-list' }, check.warnings.slice(0, 6).map((item, index) => h('li', { key: index }, item)))
                    : null,
                )
              : null,
          ),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // 构建与导出管理器
    // ---------------------------------------------------------------------
    function BuildPage() {
      const [state, refresh] = useProjectState()
      const [busy, setBusy] = React.useState('')
      const [message, setMessage] = React.useState(null)
      const [log, setLog] = React.useState([])
      const data = state.data || {}
      const exportsInfo = data.exports || {}
      const builds = data.builds || []
      const project = data.project

      async function act(name, runner) {
        setBusy(name)
        setMessage(null)
        try {
          const text = await runner()
          setMessage({ tone: 'success', text })
          setLog((items) => [text].concat(items).slice(0, 8))
          refresh()
        } catch (error) {
          setMessage({ tone: 'error', text: error.message })
          setLog((items) => ['失败：' + error.message].concat(items).slice(0, 8))
        } finally {
          setBusy('')
        }
      }

      return h(
        PageFrame,
        {
          title: '方块工坊 · 构建与导出',
          subtitle: 'design/ → 游戏格式 → .mrpack',
          refresh,
          busy: state.phase === 'refreshing',
        },
        h(
          Card,
          { title: '导出设计内容', extra: h(Badge, null, '写 build/exports/') },
          h(
            'div',
            { className: 'cw-actions' },
            h(
              Button,
              {
                primary: true,
                busy: busy === 'export-all',
                onClick: () =>
                  act('export-all', async () => {
                    const result = await api('/export', { method: 'POST', body: { target: 'all' } })
                    return '导出全部：' + result.results.map((item) => item.target + (item.ok ? ' ✓' : ' ✗ ' + (item.error || ''))).join('，')
                  }),
              },
              '导出全部',
            ),
            Object.keys(EXPORT_LABELS).map((target) =>
              h(
                Button,
                {
                  key: target,
                  busy: busy === 'export-' + target,
                  onClick: () =>
                    act('export-' + target, async () => {
                      const result = await api('/export', { method: 'POST', body: { target } })
                      const item = result.results[0] || {}
                      return item.ok ? EXPORT_LABELS[target] + ' 导出成功：' + (item.summary || '') : EXPORT_LABELS[target] + ' 导出失败：' + (item.error || '')
                    }),
                },
                '导出 ' + EXPORT_LABELS[target],
              ),
            ),
          ),
          h(
            'table',
            { className: 'cw-table' },
            h(
              'tbody',
              null,
              Object.keys(EXPORT_LABELS).map((target) => {
                const info = exportsInfo[target] || { present: false, files: 0 }
                return h(
                  'tr',
                  { key: target },
                  h('td', { className: 'cw-table-label' }, EXPORT_LABELS[target]),
                  h('td', null, h(Badge, { tone: info.present ? 'success' : 'idle' }, info.present ? info.files + ' 个文件' : '未导出')),
                  h('td', { className: 'cw-table-hint' }, 'build/exports/' + target),
                )
              }),
            ),
          ),
        ),
        h(
          Card,
          { title: '构建整合包', extra: h(Badge, null, project ? 'v' + project.versionId : '') },
          h(
            'div',
            { className: 'cw-actions' },
            h(
              Button,
              {
                primary: true,
                busy: busy === 'build',
                onClick: () =>
                  act('build', async () => {
                    const result = await api('/build', { method: 'POST', body: {} })
                    return (
                      '构建完成：' + result.outputPath + '（' + formatBytes(result.size) + '，' + result.files + ' 个 mod，' + (result.contentFiles || 0) + ' 个内容文件）'
                    )
                  }),
              },
              '构建整合包',
            ),
          ),
          h(Note, null, '构建会读取工程模组清单、overrides 与 build/exports 内容映射，产物写入 builds/。'),
          message ? h(Note, { tone: message.tone }, message.text) : null,
          log.length ? h('pre', { className: 'cw-pre' }, log.join('\n')) : null,
        ),
        h(
          Card,
          { title: '构建产物' },
          builds.length
            ? h(
                'table',
                { className: 'cw-table' },
                h(
                  'tbody',
                  null,
                  builds.map((build) =>
                    h('tr', { key: build.name }, h('td', { className: 'cw-table-label' }, build.name), h('td', null, formatBytes(build.size)), h('td', { className: 'cw-table-hint' }, formatTime(build.modified))),
                  ),
                ),
              )
            : h(Note, null, '还没有构建产物。'),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // 服务器管理器
    // ---------------------------------------------------------------------
    function ServerPage() {
      const [state, refresh] = useProjectState()
      const [server, setServer] = React.useState({ phase: 'loading' })
      const [backups, setBackups] = React.useState([])
      const [version, setVersion] = React.useState(0)
      const [host, setHost] = React.useState('')
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [message, setMessage] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        api('/server')
          .then((result) => {
            if (cancelled) return
            setServer(Object.assign({ phase: 'ready' }, result))
            if (!host && result.statusTarget && result.statusTarget.host) setHost(result.statusTarget.host)
            return api('/backups')
          })
          .then((result) => {
            if (!cancelled && result) setBackups(result.backups || [])
          })
          .catch((error) => {
            if (!cancelled) setServer({ phase: 'error', error: error.message })
          })
        return () => {
          cancelled = true
        }
      }, [version])

      async function act(name, runner) {
        setBusy(name)
        setMessage(null)
        try {
          const text = await runner()
          setMessage({ tone: 'success', text })
          setVersion((value) => value + 1)
          refresh()
        } catch (error) {
          setMessage({ tone: 'error', text: error.message })
        } finally {
          setBusy('')
        }
      }

      const project = state.data && state.data.project
      const check = server.check
      return h(
        PageFrame,
        {
          title: '方块工坊 · 服务器管理器',
          subtitle: '服务端同步 / 一致性校验 / 状态探测 / 备份',
          refresh,
          busy: state.phase === 'refreshing',
        },
        h(
          'div',
          { className: 'cw-stats' },
          h(Stat, { value: server.modsCount === null || server.modsCount === undefined ? '—' : server.modsCount, label: '服务端 mods', hint: server.dir || '' }),
          h(Stat, { value: check ? check.expected : '—', label: '应安装文件', hint: server.latestBuild ? server.latestBuild.name : '还没有构建' }),
          h(Stat, { value: check ? check.missing.length : '—', label: '缺失', hint: check ? '哈希不匹配 ' + check.mismatched.length : '', tone: check && check.missing.length ? 'warn' : undefined }),
          h(Stat, { value: backups.length, label: '备份数量', hint: 'build/backups/' }),
        ),
        h(
          Card,
          { title: '服务端操作', extra: server.latestBuild ? h(Badge, null, server.latestBuild.name) : null },
          h(
            'div',
            { className: 'cw-actions' },
            h(
              Button,
              {
                busy: busy === 'check',
                onClick: () =>
                  act('check', async () => {
                    const result = await api('/server', { method: 'POST', body: { action: 'check' } })
                    const value = result.result
                    return '一致性：应安装 ' + value.expected + '，缺失 ' + value.missing.length + '，哈希不匹配 ' + value.mismatched.length + '，多余 ' + value.extra.length
                  }),
              },
              '检查一致性',
            ),
            h(
              Button,
              {
                primary: true,
                busy: busy === 'install',
                onClick: () =>
                  act('install', async () => {
                    const result = await api('/server', { method: 'POST', body: { action: 'install' } })
                    return '已同步：' + result.result.build + '（下载 ' + result.result.downloaded.length + '，跳过 ' + result.result.skipped.length + '，失败 ' + result.result.failed.length + '）'
                  }),
              },
              '同步安装',
            ),
            h(
              Button,
              {
                busy: busy === 'backup',
                onClick: () =>
                  act('backup', async () => {
                    const result = await api('/server', { method: 'POST', body: { action: 'backup' } })
                    return '备份完成：' + result.result.name + '（' + result.result.files + ' 个文件，' + formatBytes(result.result.size) + '）'
                  }),
              },
              '备份服务端',
            ),
            h(
              Button,
              {
                busy: busy === 'generate',
                onClick: () =>
                  act('generate', async () => {
                    const result = await api('/server', { method: 'POST', body: { action: 'generate' } })
                    return '已生成服务端配置：' + result.result.kind + '，' + result.result.files.length + ' 个文件（已存在文件不覆盖）'
                  }),
              },
              '生成服务端配置',
            ),
          ),
          message ? h(Note, { tone: message.tone }, message.text) : null,
          check && (check.missing.length || check.mismatched.length || check.extra.length)
            ? h(
                'div',
                { className: 'cw-check' },
                check.missing.length ? h('div', null, h('b', null, '缺失：'), check.missing.map((item) => item.path).join('，')) : null,
                check.mismatched.length ? h('div', null, h('b', null, '哈希不匹配：'), check.mismatched.map((item) => item.path).join('，')) : null,
                check.extra.length ? h('div', null, h('b', null, '多余 jar：'), check.extra.join('，')) : null,
              )
            : check
              ? h(Note, null, '✅ 服务端 mods 与最新构建完全一致。')
              : null,
        ),
        h(
          Card,
          { title: '状态探测' },
          h(
            'div',
            { className: 'cw-form-row' },
            h(Input, { value: host, onChange: setHost, placeholder: '服务器地址，例如 play.example.com' }),
            h(
              Button,
              {
                busy: busy === 'status',
                onClick: () =>
                  act('status', async () => {
                    const result = await api('/server', { method: 'POST', body: { action: 'status', host } })
                    setStatus(result.status)
                    return '在线：' + result.status.versionName + '，玩家 ' + result.status.playersOnline + '/' + result.status.playersMax + '，延迟 ' + result.status.latencyMs + ' ms'
                  }),
              },
              '探测状态',
            ),
          ),
          status
            ? h(
                'div',
                { className: 'cw-check' },
                h('div', null, '版本：' + status.versionName + '（protocol ' + (status.protocol || '?') + '）'),
                h('div', null, '玩家：' + status.playersOnline + '/' + status.playersMax),
                h('div', null, 'MOTD：' + status.motd),
                h('div', null, '延迟：' + status.latencyMs + ' ms'),
              )
            : null,
        ),
        h(
          Card,
          { title: '备份列表' },
          backups.length
            ? h(
                'table',
                { className: 'cw-table' },
                h(
                  'tbody',
                  null,
                  backups.map((backup) =>
                    h('tr', { key: backup.name }, h('td', { className: 'cw-table-label' }, backup.name), h('td', null, formatBytes(backup.size)), h('td', { className: 'cw-table-hint' }, formatTime(backup.modified))),
                  ),
                ),
              )
            : h(Note, null, '还没有备份。'),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------
    const CSS = [
      '.cw-root{display:flex;flex-direction:column;gap:14px;padding:4px 4px 24px;color:var(--dsw-alias-label-primary);font-family:inherit;max-width:820px}',
      '.cw-header{display:flex;align-items:center;gap:12px}',
      '.cw-header-text{flex:1;min-width:0}',
      '.cw-logo{flex:none;border-radius:10px;overflow:hidden}',
      '.cw-title{margin:0;font-size:18px;line-height:26px;font-weight:600}',
      '.cw-subtitle{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.cw-button{flex:none;box-sizing:border-box;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;cursor:pointer}',
      '.cw-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.cw-button:disabled{cursor:default;color:var(--dsw-alias-label-secondary);opacity:.7}',
      '.cw-button-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.cw-button-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.cw-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px}',
      '.cw-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
      '.cw-card-title{margin:0;font-size:14px;line-height:22px;font-weight:600}',
      '.cw-card-extra{display:flex;gap:6px;align-items:center}',
      '.cw-project-name{font-size:20px;line-height:28px;font-weight:600}',
      '.cw-project-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.cw-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}',
      '.cw-badge{display:inline-flex;align-items:center;box-sizing:border-box;height:22px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}',
      '.cw-badge-brand{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:transparent}',
      '.cw-badge-success{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);background:transparent}',
      '.cw-badge-warn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);background:transparent}',
      '.cw-badge-idle{color:var(--dsw-alias-state-idle-primary)}',
      '.cw-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}',
      '.cw-stat{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px}',
      '.cw-stat-value{font-size:24px;line-height:32px;font-weight:600}',
      '.cw-stat-label{margin-top:2px;font-size:12px;line-height:18px}',
      '.cw-stat-hint{margin-top:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cw-tone-success{color:var(--dsw-alias-state-success-primary)}',
      '.cw-tone-warn{color:var(--dsw-alias-state-warn-primary)}',
      '.cw-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.cw-chip{display:inline-flex;align-items:center;box-sizing:border-box;height:24px;padding:0 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}',
      '.cw-list{margin:8px 0 0;padding-left:18px;font-size:12px;line-height:20px}',
      '.cw-error-list{color:var(--dsw-alias-state-error-primary)}',
      '.cw-warn-list{color:var(--dsw-alias-state-warn-primary)}',
      '.cw-table{width:100%;border-collapse:collapse;font-size:12px;line-height:20px}',
      '.cw-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-secondary);padding:4px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.cw-table td{padding:5px 0;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle}',
      '.cw-table tr:last-child td{border-bottom:none}',
      '.cw-table-label{color:var(--dsw-alias-label-primary);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cw-table-hint{color:var(--dsw-alias-label-secondary);text-align:right}',
      '.cw-table-actions{text-align:right;white-space:nowrap}',
      '.cw-table-actions .cw-button{height:24px;padding:0 8px;font-size:12px;margin-left:6px}',
      '.cw-actions{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}',
      '.cw-form-row{display:flex;gap:8px;align-items:center;margin-top:4px}',
      '.cw-input{box-sizing:border-box;flex:1;min-width:0;height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px}',
      '.cw-textarea{box-sizing:border-box;width:100%;min-height:300px;margin-top:2px;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;resize:vertical}',
      '.cw-split{display:grid;grid-template-columns:minmax(180px,240px) minmax(0,1fr);gap:12px;align-items:start}',
      '.cw-kind-row{display:flex;flex-wrap:wrap;gap:6px}',
      '.cw-kind{box-sizing:border-box;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;cursor:pointer}',
      '.cw-kind-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.cw-entry-list{margin:4px 0 0;padding:0;list-style:none;max-height:420px;overflow:auto}',
      '.cw-entry{display:flex;flex-direction:column;gap:2px;padding:7px 8px;border-radius:8px;cursor:pointer;font-size:12px}',
      '.cw-entry:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.cw-entry-active{background:var(--dsw-alias-bg-layer-2)}',
      '.cw-entry b{font-weight:500}',
      '.cw-entry span{color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.cw-note{margin:8px 0 0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary)}',
      '.cw-note-error{color:var(--dsw-alias-state-error-primary)}',
      '.cw-note-warn{color:var(--dsw-alias-state-warn-primary)}',
      '.cw-note-success{color:var(--dsw-alias-state-success-primary)}',
      '.cw-check{margin-top:8px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
      '.cw-check b{font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.cw-pre{margin:8px 0 0;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:17px;white-space:pre-wrap;max-height:180px;overflow:auto}',
    ].join('\n')

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------
    return {
      inject: ['slots'],
      apply(ctx) {
        const sections = [
          ['craft-workshop', 50, '方块工坊 · 概览', OverviewPage],
          ['craft-workshop-mods', 51, '方块工坊 · 模组', ModsPage],
          ['craft-workshop-design', 52, '方块工坊 · 设计', DesignPage],
          ['craft-workshop-build', 53, '方块工坊 · 构建', BuildPage],
          ['craft-workshop-server', 54, '方块工坊 · 服务器', ServerPage],
        ]
        for (const [id, order, label, Component] of sections) {
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id,
                order,
                label: () => label,
              },
              Component,
            ),
          )
        }
      },
    }
  },
})
