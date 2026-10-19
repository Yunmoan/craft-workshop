# 整合包创作工作流（Authoring Guide）

> 这是「方块工坊 CraftWorkshop」的使用手册。核心原则：**工程文件（`project.json`）+ 设计内容（`design/`）是唯一事实源；`.mrpack` 只是构建产物。**
> 不要让 Agent 直接替你写死一个成品包——让 Agent 编辑这里的源文件，再导出、构建、校验。

## 1. 工作区结构

```
project.json            # 工程文件：目标版本/加载器、模组清单、overrides、内容导出映射、输出目录
design/                 # 设计内容（创作源文件）
├── story/              #   剧情章节（story_chapter）
├── quests/             #   任务章节（quest_chapter，导出为 FTB Quests）
├── characters/         #   人物设定（character）
├── factions/           #   势力/派系（faction）
├── locations/          #   地点/地图（location）
├── lore/               #   世界观条目（lore）
├── items/              #   物品设计（item，导出为 KubeJS 草稿）
├── recipes/            #   配方设计（recipe，导出为 KubeJS 草稿）
└── _templates/         #   每种设计类型的空白模板（不参与校验/导出）
overrides/              # 手工维护、原样进包的文件（config/、kubejs/、resourcepacks/…）
build/
└── exports/            # 由 design/ 生成的游戏文件（不要手改）
    ├── ftbquests/      #   → overrides/config/ftbquests/…
    ├── patchouli/      #   → overrides/patchouli_books/…（Patchouli 指南书）
    ├── kubejs/         #   → overrides/kubejs/…
    └── design-wiki/    #   发给团队看的设计文档（Markdown）
builds/                 # 构建出的 .mrpack（输出）
```

## 2. 多项目与创建项目

一个工作区可以管多个项目，注册表默认在 `~/.craft-workshop/projects.json`：

```text
mc_project action=create  name=我的整合包 template=modpack mods=["create","jei"] id=my-pack
mc_project action=register dir=/path/to/existing id=legacy
mc_project action=list
mc_project action=use     project=my-pack        # 切换当前项目
mc_project action=remove  project=my-pack        # 只移出注册表，不删文件
```

- 模板：`modpack`（含 design/ 骨架）、`server`（含 servers.mod 指向 `server/`）、`empty`（只建 project.json）。
- 创建后目录结构：`project.json`、`design/`、`overrides/`、`builds/`。
- 其他工具用 `project=<id>` 指定项目；不指定时使用当前会话工作目录。
- Web UI 顶部项目栏等价于上面几条命令。

## 3. 设计内容数据模型

所有设计条目都是 JSON：`design/<kind>/<id>.json`。用 `mc_design action=describe kind=<kind>` 可查看某类的字段说明和示例。

| kind | 目录 | 必填 | 说明 |
|---|---|---|---|
| `character` | `characters/` | `name` | 人物档案；`faction` 引用势力、`relationships[].character` 引用人物 |
| `faction` | `factions/` | `name` | 势力/种族/神系；`leader` 引用人物、`allies`/`enemies` 引用势力 |
| `location` | `locations/` | `name` | 地点/区域/副本；`region` 可引用上级地点 |
| `lore` | `lore/` | `title` | 世界观条目，`category` 分组（history/magic/religion…） |
| `story_chapter` | `story/` | `title`、`order` | 剧情章节；正文放 `body`（Markdown）；引用人物/势力/地点/任务章节 |
| `quest_chapter` | `quests/` | `title`、`quests` | 任务章节；`quests[]` 含依赖、目标（tasks）、奖励（rewards），导出 FTB Quests |
| `item` | `items/` | `name` | 物品设计；`namespace` + `id` 即游戏内物品 id（如 `ipthmc:mist_blade`） |
| `recipe` | `recipes/` | `name`、`type` | 配方设计；`type` = shaped/shapeless/smelting/…；引用物品设计 id 或原版物品 |

交叉引用会被 `mc_design action=check` 校验：人物→势力、剧情→人物/势力/地点/任务章节、任务依赖、物品→配方、配方→物品。

## 4. 标准创作循环

```text
mc_project  action=init                 # 首次：建工程 + design/ 骨架
mc_mods     action=add refs=[...]       # 加模组（自动解析依赖并报告冲突）
mc_mods     action=resolve              # 确认依赖树无冲突
mc_design   action=describe kind=...    # 查字段说明
mc_design   action=write kind=character id=... data={...}
mc_design   action=check                # 全量校验：字段 + 交叉引用
mc_export   target=all                  # 导出 FTB Quests / Patchouli / KubeJS / 设计文档
mc_build                                # 从工程构建 .mrpack
```

日常改内容只动 `design/` 与 `project.json`，然后重复 `check → export → build`。

## 5. 导出物与游戏内实装

### FTB Quests（已实现）

- 前置：整合包装 **FTB Quests 2101.1.36（MC 1.21.1 / NeoForge）**，依赖 FTB Library、FTB Teams、Architectury。
- 输出：`build/exports/ftbquests/quests/{data.snbt, chapter_groups.snbt, chapters/*.snbt, lang/zh_cn.snbt}`。
- 映射：`project.json` → `pack.content` 里 `build/exports/ftbquests → overrides/config/ftbquests`（**必须走通用 overrides**，双端都生效；用 server-overrides 会让单机玩家没任务书）。
- 格式要点（均已按 2101.1.36 源码/真包核对）：
  - ID 为 16 位大写 hex，首位只能是 `0`–`7`（有符号 long 正区间），全库唯一；生成器用 sha256 稳定派生并去重。
  - 文本不在 SNBT 里：标题/描述写到 `lang/zh_cn.snbt`，键形如 `quest.<ID>.title`、`quest.<ID>.quest_desc`（列表，`{@pagebreak}` 切页）。
  - 章节文件名必须与 `filename` 字段一致且小写。
- 支持的任务类型：`item / kill / checkmark / advancement / stat / observation / dimension / biome / structure / location / xp`。
- 支持的奖励类型：`item / xp / xp_levels / command / toast / gamestage / currency`（`loot/random/choice` 需要奖励表，后续版本支持）。

### Patchouli 指南书（已实现）

- 用途：人物志、世界设定集、地点图鉴、物品图鉴——把 `lore` / `character` / `faction` / `location` / `item` / `story_chapter` 转成游戏内可翻阅的书。
- **external book 机制**：书必须放实例根 `patchouli_books/`，mrpack 落 `overrides/patchouli_books/<book>/`；**不能**放 `kubejs/data`、OpenLoader 或世界数据包（Patchouli 不扫数据包）。
- 输出：`build/exports/patchouli/ipthmc_guide/{book.json,en_us/categories/*.json,en_us/entries/**/**.json}`。
- 语言：Patchouli 只用 `en_us/` 作为扫描索引，因此中文内容写在 `en_us/` 下即可（单语包不需要 `zh_cn` 覆盖层）。
- 发放命令：`/give @p patchouli:guide_book[patchouli:book="patchouli:ipthmc_guide"]`。
- 物品图鉴页会自动引用 KubeJS 导出的静态配方 id（`ipthmc:<recipeId>`）。

### KubeJS（已实现）

- 用途：把 `item` / `recipe` 设计转换成 KubeJS 启动脚本与静态配方。
- 输出：`build/exports/kubejs/startup_scripts/craftworkshop_items.js` + `data/<namespace>/recipe/*.json`，映射到 `overrides/kubejs/`。
- 物品纹理需另放：`overrides/kubejs/assets/<namespace>/textures/item/<path>.png`（KubeJS 只生成模型，不生成纹理）。
- 物品注册在启动时执行一次：**新增/修改物品后必须重启游戏**；配方可用 `/reload`。
- 核心机制脚本仍建议手写在 `overrides/kubejs/`。

## 6. DSH 管理器（侧栏「方块工坊」主面板）

管理与创作有两种等价入口，底层是同一套管理器。Web 入口是**左侧栏图标打开的一级主面板页面**（不是设置弹窗），页面内分五个分页：

| 分页 | 能做什么 |
|---|---|
| 概览 | 看工程/统计/导出状态/构建与操作历史；一键导出全部、构建整合包 |
| 模组 | 加/删/解锁模组，查看解析后的版本与双端支持 |
| 设计 | 按 8 类设计浏览、直接编辑 JSON、新建、删除、全量校验 |
| 构建 | 逐项或一次导出四种格式，构建 `.mrpack`，查看构建列表与操作日志 |
| 服务器 | 检查服务端一致性、同步安装、备份、生成服务端配置、探测在线状态 |

Agent 侧的 `mc_project` / `mc_mods` / `mc_design` / `mc_export` / `mc_build` / `mc_pack_install` / `mc_pack_check` / `mc_server_config` / `mc_status` 与页面对应；两边都改同一份工程与设计源文件。操作历史记录在 `.craft-workshop/history.json`。

## 7. 设计文档导出

`mc_export target=design-wiki` 会把设计内容渲染成 Markdown（`build/exports/design-wiki/`），适合：

- 给社团成员/写手/美术看的设计 wiki；
- 提交到仓库做版本 diff；
- 作为剧情与任务的"审稿稿"。

## 8. 与服务器部署的衔接

1. `mc_build` 生成 `.mrpack`；
2. `mc_pack_install pack=... serverDir=server/neoforge` 同步服务端 mods 并校验 sha1；
3. `mc_pack_check` 复核一致性；
4. `mc_server_config` 维护服务端配置（NeoForge/Paper/Velocity/Arclight 模板）。

## 9. 约定与注意事项

- `design/<kind>/<id>.json` 的 `id` 只允许字母/数字/汉字/点/下划线/中划线，且必须等于文件名。
- 设计 id 用于稳定派生 FTB Quests 的 16hex ID：**改 id 会导致任务进度不兼容**（发布后不要随意改）。
- 中文文本直接写 UTF-8；`&7` 等旧格式码会被 FTB Quests 解析。
- `build/exports/` 是生成目录，不要手改；`overrides/` 是手工目录，两者在构建时合并进包。
- 剧情/人物/势力等内容的版权与合规由项目组自行确认。
