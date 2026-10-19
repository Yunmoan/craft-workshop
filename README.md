# 方块工坊 CraftWorkshop

> **DeepSeek Harness 插件** ｜ 包名 `@ipthmc/craft-workshop` ｜ 版本 `0.6.0`
> 单包同时提供 **Host 工具**（14 个 `mc_*`）与 **Web 主面板**（侧栏图标 + 5 个分页）。
> 由 IPTHMC 社团维护，用于 Minecraft 整合包创作与服务器运营。

---

## 它是什么

不是"一键生成成品包"，而是一条**作者向生产管线**：

```text
project.json（工程：模组清单 / 目标版本 / 构建配置）          ─┐
design/（剧情·任务·人物·势力·地点·世界观·物品·配方）      ─┼─ mc_export → FTB Quests / Patchouli / KubeJS / 设计文档
                                                              └─ mc_build  → builds/*.mrpack
```

- **多项目**：内置项目注册表，可新建、注册、切换任意多个整合包项目。
- **内容可编辑**：剧情、任务、人物等设计内容以 JSON 存盘，工具与 Web 界面都能改，带字段与交叉引用校验。
- **面向真实格式**：FTB Quests 2101.1.36、Patchouli 1.21.1-93、KubeJS 2101.7.2 的文件格式均按源码与真实整合包核对（见 `docs/research/`）。
- **服务端闭环**：`.mrpack` 自动安装到服务端目录、sha1 一致性校验、服务端配置生成、Java SLP 探活（含 SRV）。

---

## 安装

```text
plugin_manager  action=install_bundle  target=<本仓库绝对路径>
```

- 单包、单 Loader 行（`craft-workshop`），安装后同时得到 14 个模型工具与 Web 面板。
- 面板入口：**左侧栏方块图标 → 主面板「方块工坊」**。
- 卸载：`plugin_manager action=remove_bundle target=@ipthmc/craft-workshop`。

> 首次安装即可用；若在已安装状态下修改了 `dsh.client` 声明，需要重启 Harness 才会重新扫描（普通代码改动用停用/启用或重装即可生效）。

---

## 快速开始

| 步骤 | Web 面板 | Agent 工具 |
|---|---|---|
| 1. 建项目 | 顶部「新建项目」 | `mc_project action=create name=我的整合包 template=modpack` |
| 2. 加模组 | 模组页添加 | `mc_mods action=add refs=["create","jei"]` |
| 3. 写内容 | 设计页编辑 JSON | `mc_design action=write kind=character id=xxx data={...}` → `action=check` |
| 4. 导出 | 构建页「导出全部」 | `mc_export target=all` |
| 5. 构建 | 构建页「构建整合包」 | `mc_build` |
| 6. 上服务端 | 服务器页同步/校验/备份 | `mc_pack_install` / `mc_pack_check` / `mc_server_config` / `mc_status` |

---

## 工具总览（14 个）

**工程与创作**

| 工具 | 作用 |
|---|---|
| `mc_project` | `list` / `create` / `register` / `use` / `remove` / `show` / `init` / `update` —— 项目注册表与工程文件 |
| `mc_mods` | 模组清单：`list` / `add`（自动解析依赖）/ `remove` / `pin` / `unpin` / `resolve` |
| `mc_design` | 8 类设计内容：`list` / `get` / `write` / `delete` / `check` / `describe` |
| `mc_export` | 导出 `design-wiki` / `ftbquests` / `patchouli` / `kubejs` / `all` |
| `mc_build` | 从工程构建 `.mrpack`（含 overrides 与内容映射） |

**资源查询**

| 工具 | 作用 |
|---|---|
| `mc_search` | Modrinth 搜索（按 MC 版本 + 加载器过滤） |
| `mc_resource` | 资源项目详情与兼容版本（直链、sha1/sha512、依赖、双端支持） |
| `mc_resolve` | 依赖闭包解析 + 冲突/缺失警告 |
| `mc_loader` | MC / NeoForge / Forge / Fabric / Paper / Velocity / Arclight 版本 |
| `mc_pack` | 临时构建（按传入列表，不读写工程文件） |

**服务端与运维**

| 工具 | 作用 |
|---|---|
| `mc_server_config` | NeoForge / Fabric / Paper / Velocity / Arclight 服务端配置骨架 |
| `mc_pack_install` | 把 `.mrpack` 服务端内容装到服务器目录（sha1 校验 + overrides） |
| `mc_pack_check` | 服务端目录 vs 整合包一致性校验 |
| `mc_status` | Java SLP 探活（MOTD 组件展开 + `_minecraft._tcp` SRV） |

---

## 多项目与注册表

注册表默认 `~/.craft-workshop/projects.json`（config `registryFile` 可改）：

```text
mc_project action=create name=我的整合包 template=modpack mods=["create","jei"] id=my-pack
mc_project action=register dir=/path/to/existing id=legacy
mc_project action=list
mc_project action=use project=my-pack        # 切换当前项目
mc_project action=remove project=my-pack     # 只移出注册表，不删文件
```

- **模板**：`modpack`（含 `design/` 骨架）/ `server`（含 `servers.mod`）/ `empty`（仅 `project.json`）。
- **项目 id**：ASCII 小写 `a-z0-9._-`（≤48 字符）；默认取目录名，其次名称，纯中文名回落 `project-<hash>`。
- **项目参数**：`mc_mods` / `mc_design` / `mc_export` / `mc_build` 都支持 `project=<id>`；不带时使用当前会话工作目录。

---

## Web 主面板

**左侧栏方块图标 → 主面板「方块工坊」**（与 Plugins / Schedules 同级，不占用设置弹窗）。

- **项目栏**：项目下拉（当前工作区 + 已注册项目）、新建项目表单、注册当前工作区、移出注册表；选择持久化在浏览器。
- **概览**：工程摘要、四格统计、导出状态、最近构建、操作历史、一键导出/构建。
- **模组**：清单（版本 / 双端支持 / 锁定状态）+ 添加 / 移除 / 解锁 / 重新解析。
- **设计**：8 类内容列表 + JSON 编辑器 + 新建 / 保存 / 删除 / 全量校验。
- **构建**：四种导出、构建整合包、产物列表、操作日志。
- **服务器**：一致性检查、同步安装、备份、生成配置、状态探测、备份列表。

---

## 管理器 API（Web 面板使用，仅本机）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/craft-workshop/api/state` | 工程摘要 + 设计统计 + 导出/构建/服务端状态 + 操作历史 |
| GET/POST | `/craft-workshop/api/projects` | 项目注册表：`list` / `create` / `register` / `use` / `remove` |
| GET/POST | `/craft-workshop/api/mods` | 模组清单（`?resolve=1` 解析依赖） |
| GET/POST | `/craft-workshop/api/design` | 设计内容读取 / `write` / `delete` / `check` |
| POST | `/craft-workshop/api/export` | 导出指定目标 |
| POST / GET | `/craft-workshop/api/build` `…/builds` | 构建整合包 / 产物列表 |
| GET/POST | `/craft-workshop/api/server` | `status` / `install` / `check` / `backup` / `generate` |
| GET | `/craft-workshop/api/backups` `…/history` | 备份列表 / 操作历史 |

所有接口都可带 `?project=<id>` 指定项目（空值 = 强制当前工作区）；写操作仅接受本机（loopback）请求。Agent 的 `mc_*` 工具与这些接口共用同一套管理器实现。

---

## 工程与设计内容

`project.json`（工程，唯一事实源）关键字段：

```jsonc
{
  "$schema": "craft-workshop-project/1",
  "name": "我的整合包", "id": "my-pack", "kind": "modpack",
  "target": { "minecraft": "1.21.1", "loader": "neoforge", "loaderVersion": "21.1.263" },
  "pack": {
    "versionId": "0.1.0",
    "mods": [{ "id": "create" }, { "id": "jei", "versionId": "可选锁定" }],
    "overrides": { "overrides": "overrides", "clientOverrides": "", "serverOverrides": "" },
    "content": [{ "from": "build/exports/ftbquests", "to": "config/ftbquests", "zone": "overrides", "optional": true }],
    "outputDir": "builds"
  },
  "design": { "root": "design" }
}
```

`design/<kind>/<id>.json` 共 8 类：`character` 人物、`faction` 势力、`location` 地点、`lore` 世界观、`story_chapter` 剧情、`quest_chapter` 任务、`item` 物品、`recipe` 配方。字段与交叉引用规则见 [`docs/AUTHORING.md`](docs/AUTHORING.md)。

---

## 配置项（`cordis.patch.yml` 的 `config`）

| 键 | 默认 | 说明 |
|---|---|---|
| `defaultGameVersion` | `1.21.1` | 默认目标 MC 版本（工程文件优先） |
| `defaultLoader` | `neoforge` | 默认加载器 |
| `projectFile` | `project.json` | 工程文件名 |
| `designRoot` | `design` | 设计内容目录 |
| `defaultNamespace` | `ipthmc` | 导出/物品命名空间 |
| `registryFile` | 空 → `~/.craft-workshop/projects.json` | 项目注册表路径 |
| `userAgent` | `craft-workshop/0.6.0 (…)` | API 请求 UA（Modrinth/Paper 要求） |
| `defaultOutputRoot` | 空 | 相对路径基准；空 = 当前会话工作目录 |
| `cacheTtlSeconds` / `requestTimeoutMs` / `maxDependencyDepth` | 600 / 20000 / 6 | 查询与依赖解析参数 |
| `curseForgeApiKey` | 空 | 预留（无 Key 时 CurseForge 不可用） |

---

## 目录结构

```text
.
├── package.json          # DSH 插件清单（Host + Client 单包）
├── cordis.patch.yml      # Loader 行与默认 config
├── index.js              # Host 半：apply() 注册 14 个工具 + 管理器 API
├── client.js             # Web 半：主面板 + 侧栏图标（5 个分页）
├── src/                  # Host 模块：registry/project/design/exporters/mrpack/…
├── locale/{zh,en}.json   # Plugin Manager 展示元数据
├── icon.svg              # 插件图标
├── dev/smoke.mjs         # 模块级冒烟测试
└── docs/                 # 使用手册、运维手册、路线图、格式调研
```

本仓库**只包含插件本身**；具体整合包工程（`project.json`、`design/`、`builds/`、`server/` 等）由使用者在自己目录里创建，已在 `.gitignore` 中排除。

---

## 开发与验证

```bash
node dev/smoke.mjs        # 真实调用 Modrinth / NeoForge / Paper / Arclight / SLP
```

- 改动 Host 代码：停用/启用插件，或重装本包。
- 改动 `client.js`：重装本包（必要时刷新一次页面）。
- 冒烟测试覆盖：ZIP 读写、Modrinth 搜索、各加载器版本、依赖解析、`.mrpack` 构建、服务端配置生成、SLP 探活（部分用例需要外网）。

---

## 已知限制

- FTB Quests / Patchouli / KubeJS 的导出格式按源码与真实整合包核对，但**尚未在真实客户端加载验证**；首次进游戏请先备份存档。
- FTB Quests 的 `loot` / `random` / `choice` 奖励需要奖励表，暂不生成（会给出警告并跳过）。
- KubeJS 物品只生成注册脚本，纹理需另放 `kubejs/assets/<ns>/textures/item/<path>.png`。
- 未导出 `Config` schema：插件管理器不显示配置表单，改配置请编辑 `cordis.patch.yml`。
- 服务端启动需要 Java 21；本插件只生成配置与包，不含游戏运行环境。
- CurseForge 需官方 API Key（无 Key 时不可用），当前仅实现 Modrinth。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/AUTHORING.md`](docs/AUTHORING.md) | 创作工作流手册：多项目、设计数据模型、导出格式、面板说明 |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | 服务端部署与运营：NeoForge / Arclight / Velocity、代理联调、备份巡检 |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 路线图与后续候选 |
| [`docs/research/ftbquests-format.md`](docs/research/ftbquests-format.md) | FTB Quests 2101.1.36 文件格式（含 ID/文本外置等坑） |
| [`docs/research/content-stack.md`](docs/research/content-stack.md) | Patchouli / KubeJS / 对话方案调研 |
| [`docs/research/mc-apis.md`](docs/research/mc-apis.md) | Modrinth / 加载器 / PaperMC / SLP API 实测 |
| [`docs/research/pack-formats.md`](docs/research/pack-formats.md) | mrpack / packwiz / server.properties / Paper 配置规范 |
