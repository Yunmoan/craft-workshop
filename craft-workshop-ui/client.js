/**
 * CraftWorkshop Web UI — a settings page that visualizes the modpack authoring project.
 *
 * Data comes from the Host half's `/craft-workshop/api/state` route. Rendering follows
 * Harness UI rules: React from the module table, theme tokens only, no DOM outside the
 * component, and no imports of Harness Client packages.
 */
window.__ModuleLoader__.load({
  id: '@ipthmc/craft-workshop-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement

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

    const EXPORT_LABELS = {
      'design-wiki': '设计文档',
      ftbquests: 'FTB Quests',
      patchouli: 'Patchouli 指南书',
      kubejs: 'KubeJS',
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
      return (
        date.getFullYear() +
        '-' +
        pad(date.getMonth() + 1) +
        '-' +
        pad(date.getDate()) +
        ' ' +
        pad(date.getHours()) +
        ':' +
        pad(date.getMinutes())
      )
    }

    function useCraftWorkshopState() {
      const [state, setState] = React.useState({ phase: 'loading' })
      const [tick, setTick] = React.useState(0)
      React.useEffect(() => {
        let cancelled = false
        setState((previous) => (previous.phase === 'ready' ? { phase: 'refreshing', data: previous.data } : { phase: 'loading' }))
        fetch(window.location.origin + '/craft-workshop/api/state', { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error('HTTP ' + response.status))))
          .then((data) => {
            if (!cancelled) setState({ phase: 'ready', data })
          })
          .catch((error) => {
            if (!cancelled) setState({ phase: 'error', error: String((error && error.message) || error) })
          })
        return () => {
          cancelled = true
        }
      }, [tick])
      return [state, () => setTick((value) => value + 1)]
    }

    function Logo() {
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: 40, height: 40, 'aria-hidden': true, className: 'cw-logo' },
        h('rect', { width: 64, height: 64, rx: 14, fill: '#1d352b' }),
        h('path', { d: 'M32 13 51 22.5 32 32 13 22.5Z', fill: '#4ec56a' }),
        h('path', { d: 'M13 22.5 32 32 32 51 13 41.5Z', fill: '#2f6f3e' }),
        h('path', { d: 'M51 22.5 32 32 32 51 51 41.5Z', fill: '#224d2f' }),
        h('path', { d: 'M38.5 40.5 48.5 50.5', stroke: '#7a4a1f', strokeWidth: 3.4, strokeLinecap: 'round' }),
        h('path', {
          d: 'M35.5 36.2c3.6-3.8 8.8-5.6 14.2-4.2-3.2-5.6-8.6-8.6-14.6-8.1 1.9 4.1 2 8.2.4 12.3Z',
          fill: '#e8bf5a',
        }),
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

    function EmptyState() {
      return h(
        Card,
        { title: '还没有工程文件' },
        h(
          'p',
          { className: 'cw-muted' },
          '在会话里让 Agent 运行 ',
          h('code', { className: 'cw-code' }, 'mc_project action=init'),
          ' 创建工程，或确认 DSH 会话的工作目录指向项目根目录。',
        ),
      )
    }

    function Dashboard() {
      const [state, refresh] = useCraftWorkshopState()
      const data = state.data
      const project = data && data.project
      const design = (data && data.design) || { total: 0, totals: {}, errors: [], warnings: [], ok: true }
      const builds = (data && data.builds) || []
      const exportsInfo = (data && data.exports) || {}
      const kinds = Object.keys(KIND_LABELS)

      return h(
        'div',
        { className: 'cw-root' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'cw-header' },
          h(Logo),
          h(
            'div',
            { className: 'cw-header-text' },
            h('h2', { className: 'cw-title' }, '方块工坊'),
            h('p', { className: 'cw-subtitle' }, '整合包创作面板 · 工程 / 设计内容 / 导出 / 构建'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'cw-button',
              onClick: refresh,
              disabled: state.phase === 'loading' || state.phase === 'refreshing',
            },
            state.phase === 'loading' || state.phase === 'refreshing' ? '刷新中…' : '刷新',
          ),
        ),

        state.phase === 'loading'
          ? h('p', { className: 'cw-muted', 'aria-live': 'polite' }, '正在读取工程数据…')
          : state.phase === 'error'
            ? h(
                Card,
                { title: '读取失败' },
                h('p', { className: 'cw-error' }, state.error),
                h('p', { className: 'cw-muted' }, '请确认 Host 插件已加载，且会话至少调用过一次工作区工具。'),
              )
            : !data.hasProject
              ? h(EmptyState)
              : h(
                  React.Fragment,
                  null,
                  h(
                    Card,
                    { title: '工程' },
                    h(
                      'div',
                      { className: 'cw-project' },
                      h('div', { className: 'cw-project-name' }, project.name),
                      h('div', { className: 'cw-project-meta' }, project.id + ' · v' + project.versionId),
                      h(
                        'div',
                        { className: 'cw-badges' },
                        h(Badge, { tone: 'brand' }, 'Minecraft ' + project.target.minecraft),
                        h(Badge, null, project.target.loader + (project.target.loaderVersion ? ' ' + project.target.loaderVersion : '')),
                        project.website ? h(Badge, null, project.website) : null,
                      ),
                    ),
                    project.summary ? h('p', { className: 'cw-muted' }, project.summary) : null,
                    h('p', { className: 'cw-path' }, data.workspaceRoot),
                  ),

                  h(
                    'div',
                    { className: 'cw-stats' },
                    h(Stat, { value: project.modsCount, label: '模组', hint: project.pinnedCount ? project.pinnedCount + ' 个已锁定版本' : '全部跟随最新版' }),
                    h(Stat, { value: design.total, label: '设计内容', hint: design.ok ? '校验通过' : '存在问题', tone: design.ok ? 'success' : 'warn' }),
                    h(Stat, { value: data.buildsTotal, label: '构建产物', hint: builds[0] ? formatTime(builds[0].modified) : '还没有构建' }),
                    h(Stat, {
                      value: data.serverMods === null ? '—' : data.serverMods,
                      label: '服务端 mods',
                      hint: data.serverMods === null ? '未部署' : 'server/neoforge/mods',
                    }),
                  ),

                  h(
                    Card,
                    { title: '设计内容', extra: h(Badge, { tone: design.ok ? 'success' : 'warn' }, design.ok ? '校验通过' : design.errors.length + ' 错误') },
                    h(
                      'div',
                      { className: 'cw-chips' },
                      kinds.map((kind) =>
                        h(
                          'span',
                          { key: kind, className: 'cw-chip' },
                          KIND_LABELS[kind],
                          h('b', null, ' ' + (design.totals[kind] || 0)),
                        ),
                      ),
                    ),
                    design.errors && design.errors.length
                      ? h(
                          'ul',
                          { className: 'cw-list cw-error-list' },
                          design.errors.slice(0, 5).map((message, index) => h('li', { key: index }, message)),
                        )
                      : null,
                    design.warnings && design.warnings.length
                      ? h(
                          'ul',
                          { className: 'cw-list cw-warn-list' },
                          design.warnings.slice(0, 4).map((message, index) => h('li', { key: index }, message)),
                        )
                      : null,
                  ),

                  h(
                    Card,
                    { title: '导出状态' },
                    h(
                      'table',
                      { className: 'cw-table' },
                      h('tbody', null,
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
                    h('p', { className: 'cw-muted' }, '导出由 Agent 的 mc_export target=all 生成，再 mc_build 才会打进整合包。'),
                  ),

                  h(
                    Card,
                    { title: '最近构建' },
                    builds.length
                      ? h(
                          'table',
                          { className: 'cw-table' },
                          h('tbody', null,
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
                      : h('p', { className: 'cw-muted' }, '还没有 .mrpack；让 Agent 运行 mc_build。'),
                  ),

                  h(
                    'p',
                    { className: 'cw-footer' },
                    '数据更新于 ' + formatTime(data.generatedAt) + ' · 常用命令：mc_mods / mc_design / mc_export / mc_build',
                  ),
                ),
      )
    }

    const CSS = [
      '.cw-root{display:flex;flex-direction:column;gap:14px;padding:4px 4px 24px;color:var(--dsw-alias-label-primary);font-family:inherit;max-width:760px}',
      '.cw-header{display:flex;align-items:center;gap:12px}',
      '.cw-header-text{flex:1;min-width:0}',
      '.cw-logo{flex:none;border-radius:10px;overflow:hidden}',
      '.cw-title{margin:0;font-size:18px;line-height:26px;font-weight:600}',
      '.cw-subtitle{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.cw-button{flex:none;box-sizing:border-box;height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;cursor:pointer}',
      '.cw-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.cw-button:disabled{cursor:default;color:var(--dsw-alias-label-secondary)}',
      '.cw-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px}',
      '.cw-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}',
      '.cw-card-title{margin:0;font-size:14px;line-height:22px;font-weight:600}',
      '.cw-project{display:flex;flex-direction:column;gap:6px}',
      '.cw-project-name{font-size:20px;line-height:28px;font-weight:600}',
      '.cw-project-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.cw-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}',
      '.cw-badge{display:inline-flex;align-items:center;box-sizing:border-box;height:22px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}',
      '.cw-badge-brand{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:transparent}',
      '.cw-badge-success{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);background:transparent}',
      '.cw-badge-warn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);background:transparent}',
      '.cw-badge-idle{color:var(--dsw-alias-state-idle-primary)}',
      '.cw-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}',
      '.cw-stat{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px}',
      '.cw-stat-value{font-size:24px;line-height:32px;font-weight:600}',
      '.cw-stat-label{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}',
      '.cw-stat-hint{margin-top:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cw-tone-success{color:var(--dsw-alias-state-success-primary)}',
      '.cw-tone-warn{color:var(--dsw-alias-state-warn-primary)}',
      '.cw-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.cw-chip{display:inline-flex;align-items:center;box-sizing:border-box;height:24px;padding:0 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}',
      '.cw-list{margin:8px 0 0;padding-left:18px;font-size:12px;line-height:20px}',
      '.cw-error-list{color:var(--dsw-alias-state-error-primary)}',
      '.cw-warn-list{color:var(--dsw-alias-state-warn-primary)}',
      '.cw-table{width:100%;border-collapse:collapse;font-size:12px;line-height:20px}',
      '.cw-table td{padding:5px 0;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle}',
      '.cw-table tr:last-child td{border-bottom:none}',
      '.cw-table-label{color:var(--dsw-alias-label-primary);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cw-table-hint{color:var(--dsw-alias-label-secondary);text-align:right}',
      '.cw-muted{margin:6px 0 0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary)}',
      '.cw-error{margin:0;font-size:12px;line-height:19px;color:var(--dsw-alias-state-error-primary)}',
      '.cw-path{margin:8px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-state-idle-primary);word-break:break-all}',
      '.cw-footer{margin:2px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
      '.cw-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2)}',
    ].join('\n')

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'craft-workshop',
              order: 50,
              label: () => '方块工坊',
            },
            Dashboard,
          ),
        )
      },
    }
  },
})
