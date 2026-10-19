# 方块工坊 CraftWorkshop（`@ipthmc/craft-workshop`）

IPTHMC 社团的 **Minecraft 整合包创作工具**（DSH Host 插件）。它不是一个"一键生成成品包"的工具，而是一条作者向的生产管线：

> **工程文件 + 设计内容 = 创作源；导出 + 构建 = 产物。**

让 Agent 编辑 `project.json`（模组清单/版本/构建配置）和 `design/`（剧情、任务、人物、势力、地点、世界观、物品、配方），再导出成 FTB Quests / Patchouli / KubeJS / 设计文档，最后构建 `.mrpack` 并同步服务端。

- 目标版本：**Minecraft 1.21.1 / NeoForge**（可配置）
- 任务系统：**FTB Quests 2101.1.36**（导出器已按源码与真实包核对）
- 指南书：**Patchouli 1.21.1-93**（external book，导出自人物志/设定集/图鉴）
- 脚本/自定义内容：**KubeJS 2101.7.2**（导出自定义物品注册与静态配方）
- 分发：Modrinth `.mrpack`；服务端：NeoForge / Paper / Velocity / Arclight

## 工具一览

**工程与内容创作**

| 工具 | 作用 |
|---|---|
| `mc_project` | 工程管理：`show` / `init`（建 design 骨架）/ `update`（包名、版本、目标 MC/加载器、目录） |
| `mc_mods` | 模组清单编辑：`list` / `add`（自动解析依赖）/ `remove` / `pin` / `unpin` / `resolve`，直接写回工程文件 |
| `mc_design` | 设计内容编辑：`list` / `get` / `write` / `delete` / `check`（字段+交叉引用校验）/ `describe` |
| `mc_export` | 导出：`design-wiki` / `ftbquests` / `patchouli` / `kubejs` / `all` |
| `mc_build` | **从工程构建** `.mrpack`（读取模组清单 + overrides + 内容导出映射） |

**资源查询**

| 工具 | 作用 |
|---|---|
| `mc_search` | Modrinth 搜索（按 MC 版本 + 加载器 facets 过滤） |
| `mc_resource` | 资源项目详情与兼容版本（下载直链、sha1/sha512、依赖、双端支持） |
| `mc_resolve` | 依赖闭包解析（required/optional）+ 冲突与缺失警告 |
| `mc_loader` | MC / NeoForge / Forge / Fabric / Paper / Velocity / Arclight 版本与直链 |
| `mc_pack` | 临时构建（按传入列表，不读写工程文件；正式流程用 `mc_build`） |

**服务端与运维**

| 工具 | 作用 |
|---|---|
| `mc_server_config` | 生成 NeoForge/Fabric/Paper/Velocity/Arclight 服务端配置骨架 |
| `mc_pack_install` | 把 `.mrpack` 服务端内容装到服务器目录（sha1 校验 + overrides） |
| `mc_pack_check` | 服务端目录 vs 整合包一致性校验 |
| `mc_status` | Java SLP 服务器探活（MOTD 组件展开 + `_minecraft._tcp` SRV） |

## 通用项目（多项目注册表）

工具不再绑定某一个工作区：项目记录在注册表里（默认 `~/.craft-workshop/projects.json`，可用 config `registryFile` 改），可以新建、注册、切换、移出任意多个项目。

| 动作 | 说明 |
|---|---|
| `mc_project action=create` | 新建项目：`name`（必填）、`dir`（默认 `工作区/<id>`）、`template`（`modpack` / `server` / `empty`）、`minecraft` / `loader` / `loaderVersion`、`mods`（种子模组）、`git`（可选 `git init`）、`id`（显式项目 id）、`use`（默认切换为当前项目） |
| `mc_project action=register` | 把已有目录（含 `project.json`）纳入注册表，`id` 省略时用目录名 |
| `mc_project action=list` | 列出项目、检测工程文件是否缺失、显示当前激活项目 |
| `mc_project action=use` | 切换激活项目（`project=<id>`；留空 = 清除） |
| `mc_project action=remove` | 仅从注册表移除，**不会删除任何文件** |

- **项目 id 规则**：ASCII 小写（`a-z0-9._-`，≤48 字符）；未显式给 `id` 时优先取目录名，其次名称；名称无 ASCII 字符时回落为 `project-<hash>`。
- **其他创作工具支持 `project` 参数**：`mc_mods` / `mc_design` / `mc_export` / `mc_build` 都可用 `project=<id>` 指定项目；不带该参数时仍使用当前会话工作目录（避免误操作别的项目）。

## 管理器 API（Web UI 用）

Host 半在 `webServer` 上注册了一套**仅限本机**的管理器接口（POST 会校验来源地址必须是本机），供 Web UI 使用；Agent 也可以直接调试：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/craft-workshop/api/state` | 工程摘要 + 8 类设计统计 + 校验问题 + 导出状态 + 最近构建 + 操作历史 |
| GET | `/craft-workshop/api/history` | 最近 60 条操作历史 |
| GET | `/craft-workshop/api/mods?resolve=1` | 模组清单，可选解析出最新版本与依赖树 |
| POST | `/craft-workshop/api/mods` | `{ action: add/remove/pin/unpin, refs, versionId }` |
| GET | `/craft-workshop/api/design?kind=&id=` | 设计列表 / 单条内容 |
| POST | `/craft-workshop/api/design` | `{ action: write/delete/check, kind, id, data }` |
| POST | `/craft-workshop/api/export` | `{ target: design-wiki/ftbquests/patchouli/kubejs/all }` |
| POST | `/craft-workshop/api/build` | 从工程构建 `.mrpack` |
| GET | `/craft-workshop/api/builds` | 构建产物列表 |
| GET | `/craft-workshop/api/server` | 服务端目录、mods 数、最新构建、一致性检查 |
| POST | `/craft-workshop/api/server` | `{ action: status/install/check/backup/generate }` |
| GET | `/craft-workshop/api/backups` | 服务端备份列表（`build/backups/`） |

管理器内部拆成 ProjectManager / ModManager / DesignManager / ExportManager / BuildManager / ServerManager 六块，工具（`mc_*`）与 Web UI 走同一套实现，避免两边逻辑漂移。操作历史写在 `.craft-workshop/history.json`（已 gitignore）。

## 工程文件（默认 `project.json`）

```jsonc
{
  "$schema": "craft-workshop-project/1",
  "name": "永世幻想间",
  "id": "ipthmc",
  "target": { "minecraft": "1.21.1", "loader": "neoforge", "loaderVersion": "21.1.263" },
  "pack": {
    "versionId": "0.1.0",
    "summary": "整合包简介",
    "mods": [{ "id": "create" }, { "id": "jei", "versionId": "可选锁定版本" }],
    "overrides": { "overrides": "overrides", "clientOverrides": "", "serverOverrides": "" },
    "content": [
      { "from": "build/exports/ftbquests", "to": "config/ftbquests", "zone": "overrides" },
      { "from": "build/exports/patchouli", "to": "kubejs/data", "zone": "overrides" },
      { "from": "build/exports/kubejs", "to": "kubejs", "zone": "overrides" }
    ],
    "outputDir": "builds"
  },
  "design": { "root": "design" }
}
```

`pack.content` 控制"导出的游戏文件如何进入整合包"：`from` 是导出目录，`zone` 是 mrpack 的 `overrides` / `client-overrides` / `server-overrides`，`to` 是包内子路径。

## 设计内容（`design/<kind>/<id>.json`）

| kind | 目录 | 用途 / 导出目标 |
|---|---|---|
| `story_chapter` | `story/` | 剧情章节（正文 Markdown）→ 设计 wiki / Patchouli 叙事 |
| `quest_chapter` | `quests/` | 任务章节（依赖、目标、奖励）→ **FTB Quests** |
| `character` | `characters/` | 人物档案（关系网、势力、出场章节）→ 设计 wiki / Patchouli |
| `faction` | `factions/` | 势力、种族、神系 |
| `location` | `locations/` | 地点、区域、地图、副本 |
| `lore` | `lore/` | 世界观条目 |
| `item` | `items/` | 自定义物品设计 → KubeJS 草稿 |
| `recipe` | `recipes/` | 配方设计 → KubeJS 草稿 |

`mc_design action=check` 会做字段校验和交叉引用校验（例如剧情引用的人物不存在、任务依赖的任务 id 不存在、配方引用的物品不存在）。

## 导出目标状态

| 目标 | 状态 | 说明 |
|---|---|---|
| `design-wiki` | ✅ 已实现 | `build/exports/design-wiki/*.md` |
| `ftbquests` | ✅ 已实现 | 按 FTB Quests 2101.1.36 格式：`data.snbt`、`chapter_groups.snbt`、`chapters/*.snbt`、`lang/<locale>.snbt`；16hex ID 稳定派生（首位 0–7）、文本外置 lang、跨章节依赖 |
| `patchouli` | ✅ 已实现 | external book → `build/exports/patchouli/<book>/`，映射到 `overrides/patchouli_books/<book>/` |
| `kubejs` | ✅ 已实现 | `startup_scripts/` 物品注册 + `data/<ns>/recipe/*.json` 静态配方，映射到 `overrides/kubejs/` |

导出格式依据：[`../docs/research/ftbquests-format.md`](../docs/research/ftbquests-format.md)、[`../docs/research/content-stack.md`](../docs/research/content-stack.md)。设计数据模型与完整工作流见 [`../docs/AUTHORING.md`](../docs/AUTHORING.md)。

## 配置项（`cordis.patch.yml`）

| 键 | 默认 | 说明 |
|---|---|---|
| `defaultGameVersion` | `1.21.1` | 默认目标 MC 版本（工程文件优先） |
| `defaultLoader` | `neoforge` | 默认加载器 |
| `projectFile` | `project.json` | 工程文件路径 |
| `designRoot` | `design` | 设计目录 |
| `defaultNamespace` | `ipthmc` | 导出命名空间/物品命名空间 |
| `userAgent` | `craft-workshop/0.5.0 (...)` | API 请求 UA |
| `defaultOutputRoot` | 空 | 相对路径基准；空 = 当前会话目录 |
| `cacheTtlSeconds` / `requestTimeoutMs` / `maxDependencyDepth` | 600 / 20000 / 6 | 查询与解析参数 |
| `curseForgeApiKey` | 空 | 预留 |

## 已知限制

- FTB Quests 文件格式按 2101.1.36 源码与真实整合包数据生成，但**尚未在真实客户端加载验证**（本机无 Java/游戏环境）；首次进游戏请先备份存档再验证任务书。
- `loot/random/choice` 奖励需要奖励表，暂未生成（会给出 warning 并跳过）。
- Patchouli 书必须放在实例根目录（mrpack 为 `overrides/patchouli_books/`），**不能**放 `kubejs/data`、OpenLoader 或世界数据包；`en_us/` 是扫描索引，中文内容写在 `en_us/` 下即可（单语包）。
- KubeJS 物品注册在启动时执行一次：新增/修改物品必须重启游戏；纹理需另放 `kubejs/assets/<ns>/textures/item/<path>.png`。
- 物品/配方导出是"生成起点"：复杂 NBT、模型、工具属性等仍建议手写脚本或资源包。
- 服务端启动需要 Java 21；本插件只生成配置与包，不包含游戏运行环境。

## 本地开发

```bash
node dev/smoke.mjs   # 模块级冒烟测试（真实调用 Modrinth/NeoForge/Paper/Arclight/SLP）
```

安装/升级：DSH `plugin_manager` 的 `install_bundle`，target 指向本目录绝对路径；卸载用 `remove_bundle`。
