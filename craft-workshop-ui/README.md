# 方块工坊 Web UI（`@ipthmc/craft-workshop-ui`）

「方块工坊 CraftWorkshop」的 DSH Web 主面板：**左侧栏图标 → 主面板页面**，页面内再分五个分页。

| 位置 | 说明 |
|---|---|
| 侧栏入口 | `sidebar.panellist`，图标排在 Plugins / Schedules / dsh-context 之后（order 25），标签「方块工坊」 |
| 主面板 | `main` 面板（key = `craft-workshop`）——与 Plugins、Schedules 同级的一级页面，**不再放在设置弹窗里** |
| 分页 | 顶部 tab：**概览 / 模组 / 设计 / 构建 / 服务器** |

## 项目栏（顶部）

面板顶部有一行项目操作，让同一个 UI 服务任意多个项目：

- **项目下拉**：「当前工作区」+ 注册表里的每个项目（标注 id、工程文件缺失时会提示）；选择会记到浏览器 `localStorage`，刷新后保持。
- **新建项目**：展开表单填名称、目录（留空 = 工作区/<名称>）、Minecraft 版本、加载器、模板（modpack / server / empty）、种子模组，创建后自动切换过去。
- **注册当前工作区**：把当前会话工作目录纳入注册表。
- **移出注册表**：只移除记录，不删除文件。
- 所有 API 调用都会带上 `?project=<id>`（选「当前工作区」时传空值，强制走工作区）。

## 五个分页

| 分页 | 功能 |
|---|---|
| **概览** | 工程卡片（名称/ID/版本/目标 MC+加载器/官网/工作目录）、四格统计（模组/设计/构建/服务端 mods）、快捷操作（导出全部 / 构建整合包）、设计校验摘要、导出状态、最近构建、操作历史 |
| **模组** | 表格：模组 id / 名称 / 版本 / 客户端与服务端支持 / 锁定状态；添加（`slug` 或 `slug@versionId`）、移除、解锁、重新解析依赖（含警告） |
| **设计** | 8 类设计（人物/势力/地点/世界观/剧情/任务/物品/配方）左侧列表 + 右侧 JSON 编辑器；新建 / 保存 / 删除 / 全量校验（字段 + 交叉引用） |
| **构建** | 四种导出（设计文档 / FTB Quests / Patchouli / KubeJS）逐项或一键、构建整合包、导出状态表、构建产物列表、操作日志 |
| **服务器** | 服务端 mods 数 / 应安装文件数 / 缺失与哈希不匹配统计、检查一致性、同步安装、备份服务端、生成服务端配置、状态探测（含 SRV）、备份列表 |

## 布局与规范

- 页面为整页布局：`height:100%` + 头部（标题/工程摘要/刷新）+ 顶部 tab 栏 + 可滚动内容区。
- 宽内容按 `repeat(auto-fit,minmax(...))` 自适应；卡片区在窄屏（容器查询 `@container cw (width<=760px)`）自动转单列。
- 设计页使用左右分栏（列表 + 编辑器），编辑器为等宽字体、可纵向拉伸。
- 只使用 Harness 主题 token（`--dsw-alias-*`、`--ds-font-family-code`），不引入 Harness Client 包，不在组件外操作 DOM；所有注册都在 `apply` 内、随插件卸载回收。
- 侧栏图标组件的 owner props 是 `{ size, active }`，激活时用品牌色高亮。

## 数据来源与操作

浏览器端只调用 Host 插件 `@ipthmc/craft-workshop` 的**本机管理接口**（写操作限制 loopback）：

```
GET  /craft-workshop/api/state      GET  /craft-workshop/api/server
GET  /craft-workshop/api/mods        POST /craft-workshop/api/mods
GET  /craft-workshop/api/design      POST /craft-workshop/api/design
POST /craft-workshop/api/export      POST /craft-workshop/api/build
GET  /craft-workshop/api/backups     GET  /craft-workshop/api/history
```

Agent 侧的 `mc_*` 工具与页面走同一套管理器实现，两种入口行为一致。

## 更新注意

- 改 `client.js` 后重新安装本 bundle（`plugin_manager` remove + install）即可在运行中的页面生效；若没刷新，按一次浏览器刷新。
- 本包与 Host 插件分开，是因为 `dsh.client` 声明必须在安装/扫描时就存在（Host 侧包元数据在重启前有缓存）。
