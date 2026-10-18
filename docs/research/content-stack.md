# 方块工坊内容栈调研：Patchouli / KubeJS / 剧情对话（MC 1.21.1 NeoForge）

> 调研日期 2026-10-18。结论以 1.21.1 NeoForge 为准；✅ 已验证可用，⚠️ 可用但有坑/待实测，❌ 不可用或不推荐。所有路径用 `/`。
> 一句话：**Patchouli 的书必须放实例根 `patchouli_books/`（mrpack 的 `overrides/`），不能放 `kubejs/data` 或其他数据包**；KubeJS 的 `data/` 能承载普通数据包内容和 RPG Dialogue，但不能让 Patchouli 发现新书。

## 1. Patchouli

### 1.1 版本与书的位置（最关键）

- 1.21.1 NeoForge 最新：`1.21.1-93-neoforge`（2026-03-08，`Patchouli-1.21.1-93-NEOFORGE.jar`）[Modrinth](https://modrinth.com/mod/patchouli/versions?g=1.21.1&l=neoforge)。
- source 事实：`BookRegistry.init()` 只遍历 **ModList 中每个 mod 的 jar 根路径**去找 `data/<modid>/patchouli_books/<book>/book.json`，然后 `BookFolderLoader.findBooks()` 扫描实例根 `patchouli_books/`；**它从不查询 datapack 列表**。[BookRegistry.java](https://github.com/VazkiiMods/Patchouli/blob/release-1.21.1-93/Xplat/src/main/java/vazkii/patchouli/common/book/BookRegistry.java) · [BookFolderLoader.java](https://github.com/VazkiiMods/Patchouli/blob/release-1.21.1-93/Xplat/src/main/java/vazkii/patchouli/common/book/BookFolderLoader.java)
- 作者/维护者也明确说过：`book.json` 虽然长在 `data/` 下，但“不是从 datapack 加载的”，modpack 用实例根 `patchouli_books`。[Issue #355 评论](https://github.com/VazkiiMods/Patchouli/issues/355#issuecomment-792802258)
- 截至 2026-10，PR [#849](https://github.com/VazkiiMods/Patchouli/pull/849) 仍 open：它才允许 external book 从资源包/KubeJS assets 读取正文。**现在 external book 的正文只从实例根目录读，`use_resource_pack` 对它无效。**

| 候选位置 | 能声明新书？ | 结论 |
|---|---|---|
| `kubejs/data/<ns>/patchouli_books/...` | ❌ | KubeJS 的 data 是虚拟数据包，但 Patchouli 不扫 datapack；不要把 `book.json` 放这里 |
| `config/openloader/data/...` | ❌ | 同上，OpenLoader 只是 datapack；书不会被发现 |
| 存档 `datapacks/` | ❌ | 同上；且 mrpack 不打包存档 |
| `kubejs/assets` / 资源包 | ⚠️ | 只能放已有书的正文覆盖、图片、声音、lang；不能凭它新建书（PR #849 未合并） |
| **实例根 `patchouli_books/`** | ✅ | **官方 external book 机制；整合包首选** |
| mod jar 的 `data/<modid>/...` + `assets/<modid>/...` | ✅ | 可自定义命名空间，但需要发 jar，不适合本插件的最小导出 |

**推荐落地**：`overrides/patchouli_books/<book>/`（`overrides/` 同时进客户端和专服；其根就是 `.minecraft`/专服根，**不要**写成 `overrides/.minecraft/patchouli_books`；也不要只放 `client-overrides/`）。专服也必须有，因为 `ItemModBook.use` 在服务端查 `BookRegistry`，缺书会直接失败。book id 固定为 `patchouli:<book>`（external 的 namespace 永远是 `patchouli`）。

### 1.2 目录结构（external book）

```text
patchouli_books/blockworkshop_guide/
  book.json
  en_us/
    categories/*.json          # 分类，可嵌套子目录
    entries/**/*.json          # 章节；子目录只是组织，id 是相对 entries 的路径
    templates/*.json           # 可选，自定义页面模板
  zh_cn/
    entries/**/*.json          # 只覆盖 en_us 已存在的文件，不能新增条目
```

`en_us` 是**主语言和扫描索引**：external loader 的 `findFiles` 只遍历 `en_us/`；`zh_cn` 只是在同一 id 上按当前语言替换文件。因此 `en_us` 必须完整，`zh_cn` 只放要翻译的覆盖文件；缺失文件自动回退 `en_us`。book.json 本身没有语言子目录。[getting-started](https://vazkiimods.github.io/Patchouli/docs/patchouli-basics/getting-started/) · [BookContentExternalLoader.java](https://github.com/VazkiiMods/Patchouli/blob/release-1.21.1-93/Xplat/src/main/java/vazkii/patchouli/client/book/BookContentExternalLoader.java)

### 1.3 book.json 字段

官方示例最小字段是 `name`、`landing_text`；external book 建议显式写以下键：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 书名；`ItemModBook.getName` 用 `Component.translatable(name)`，写普通字符串也能显示 |
| `landing_text` | 是（文档） | 落地页文本；source 有默认 key，但导出时务必显式写 |
| `use_resource_pack` | external 可省 | 非 external（mod jar）从 1.20 起**必须为 true**；external 实际忽略，填 `false`/省略 |
| `book_texture` | 否 | 默认 `patchouli:textures/gui/book_brown.png`；内置 blue/brown/cyan/gray/green/purple/red |
| `model` | 否 | 默认 `patchouli:book_brown`；内置同系列；文档说 Patchouli 会自动注册 |
| `creative_tab` | 否 | 默认 null（不进创造标签）；建议 `minecraft:tools_and_utilities` |
| `i18n` | 否 | true 时把 category/entry/page 的 `name`/`text` 当翻译 key 查 lang；默认 false |
| `version` / `subtitle` | 否 | 版本号显示 “N Edition”；不设则显示 subtitle |
| `macros` | 否 | 自定义 `$(...)` 宏，覆盖默认宏 |
| `text_color`/`header_color` 等 | 否 | 十六进制 RRGGBB；一般用默认 |

字段级来源：[book-json](https://vazkiimods.github.io/Patchouli/docs/reference/book-json/) · 构造器实现：[Book.java](https://github.com/VazkiiMods/Patchouli/blob/release-1.21.1-93/Xplat/src/main/java/vazkii/patchouli/common/book/Book.java)

### 1.4 category / entry 字段

- Category：`name`、`description`、`icon` 必填；`parent`（全限定 id）、`sortnum`、`secret`、`flag` 可选。category id = `en_us/categories/` 下的相对路径，例如 `patchouli:characters`.
- Entry：`name`、`icon`、`category`、`pages[]` 必填；`advancement`、`flag`、`sortnum`、`priority`、`secret`、`read_by_default`、`turnin`、`extra_recipe_mappings`、`entry_color` 可选。
- **`category` 必须全限定**；1.21.1 source 对无冒号的 category 直接抛异常。external book 全部写 `patchouli:<category>`。
- `extra_recipe_mappings` 是 `{ "item or itemstack string": pageIndex }`，pageIndex 从 0 开始，用于右键物品跳转/配方查询。
- 锁定/交任务：`advancement` 锁 entry 或单页；`turnin` 让 entry 显示“待完成”；`patchouli:quest` 页可显示任务勾。[entry-json](https://vazkiimods.github.io/Patchouli/docs/reference/entry-json/) · [advancement-locking](https://vazkiimods.github.io/Patchouli/docs/patchouli-basics/advancement-locking/)

### 1.5 页面类型与最小字段

| `type` | 最小字段 | 用途 |
|---|---|---|
| `patchouli:text` | `text` | 叙事/设定；`title` 可选，但**第一页不能有 title**；字符串简写等价于 text 页 |
| `patchouli:image` | `images`（数组，资源位置） | 立绘/地图/截图；可选 `title`、`text`、`border`；图片放 `assets/<ns>/textures/...` |
| `patchouli:crafting` | `recipe` | 合成配方；可选 `recipe2`、`title`、`text` |
| `patchouli:smelting` / `blasting` / `smoking` / `campfire` / `smithing` / `stonecutting` | `recipe` | 对应炉系/切石/锻造配方；字段同 crafting 系 |
| `patchouli:spotlight` | `item` | 物品/标签展示；可选 `title`、`text`、`link_recipe`；可写 `minecraft:diamond_sword` 或 ingredient 对象 |
| `patchouli:entity` | `entity` | 展示实体（人物/怪物）；可选 `scale`、`offset`、`name`、`text`、`rotate` |
| `patchouli:link` | `url`、`link_text` | 外链按钮；本质是 text 页 |
| `patchouli:relations` | `entries`（数组） | “相关章节”链接 |
| `patchouli:quest` | 无（`trigger` 可选） | 任务目标页；一个 entry 只放一个 |
| `patchouli:empty` | 无 | 占位/排版 |
| `patchouli:multiblock` | `name` + `multiblock` 或 `multiblock_id` | 多方块预览；生成器一般不用 |

来源：[page-types](https://vazkiimods.github.io/Patchouli/docs/patchouli-basics/page-types/)；实际注册表见 [ClientBookRegistry.java](https://github.com/VazkiiMods/Patchouli/blob/release-1.21.1-93/Xplat/src/main/java/vazkii/patchouli/client/book/ClientBookRegistry.java)。

### 1.6 富文本 / 宏

- 常用：`$(br)`、`$(br2)`、`$(li)`/`$(li2)`、`$(#ff0000)`、`$(l:patchouli:entry)`、`$(l:entry#anchor)`、`$(t:tooltip)`、`$(c:/command)`、`$(playername)`。
- 默认宏：`$(item)`、`$(thing)`、`$(bold)`、`$(italic)`、`$(reset)` 等；`$(list` 是故意不闭合，以支持 `$(list2)`。
- 自定义宏写在 book.json 的 `"macros": { "$(potato)": "$(#F00)POTATO$()" }`。
- 文本里的命令点击适合“假选择”（`/trigger` + scoreboard），但**不是真正的对话分支**；复杂剧情用对话 mod。
- 来源：[text-formatting](https://vazkiimods.github.io/Patchouli/docs/patchouli-basics/text-formatting/)

### 1.7 语言/i18n 结论

- 最稳：`en_us` 完整正文 + `zh_cn` 同路径覆盖；不需要 `i18n`；`zh_cn` 不能新增 entry/category。
- `i18n: true` 是另一条路：JSON 里写翻译 key，语言文件放资源包 `assets/<book-ns>/lang/zh_cn.json`；适合文本量大、结构不变的项目，但 external book 的 namespace 是 `patchouli`，key 要加前缀避免冲突。
- **不要**把 `zh_cn` 当成第二套完整书；Patchouli 只从 `en_us` 枚举文件。

## 2. KubeJS

### 2.1 版本与依赖

- 1.21.1 NeoForge 最新：`2101.7.2-build.377`（2026-09-09，`kubejs-neoforge-2101.7.2-build.377.jar`）；`2101` 就是 1.21.1 线。[Modrinth](https://modrinth.com/mod/kubejs/versions?g=1.21.1&l=neoforge)
- 必带依赖：**Rhino**（`2101.2.7-build.85`）和 **Better Advanced Tooltips**（`2101.1.0-build.5`）；`mc_resolve` 已实测解析。[Rhino](https://modrinth.com/mod/rhino) · [BAT](https://modrinth.com/mod/better-advanced-tooltips)
- KubeJS 的脚本是 JavaScript（Rhino），不是 Java；`/reload` 能重载 server scripts/data，不能重载物品注册。

### 2.2 目录

```text
kubejs/
  startup_scripts/     # 注册物品/方块/流体等，游戏启动时跑一次
  server_scripts/      # 配方/标签/事件，进世界或 /reload 时跑
  client_scripts/      # 客户端事件/渲染
  assets/<namespace>/  # 永远加载的资源包：纹理、模型、lang、声音
  data/<namespace>/    # 永远加载的数据包：recipe、advancement、loot_table、tags、function…
  config/              # KubeJS 配置（可选）
```

`assets` 等价于一直启用的资源包；`data` 等价于一直启用的数据包，不能从数据包列表里关掉，`/reload` 可重载。[folder-structure/data](https://kubejs.com/wiki/folder-structure/data) · [folder-structure/assets](https://kubejs.com/wiki/folder-structure/assets)

### 2.3 自定义物品（startup）

```js
// kubejs/startup_scripts/items.js
StartupEvents.registry('item', event => {
  event.create('lore_page')                 // 不写命名空间 => kubejs:lore_page
    .displayName('残页')
    .texture('kubejs:item/lore_page')        // assets/kubejs/textures/item/lore_page.png
    .maxStackSize(16)
})
```

- 必填只有 id；`type` 可作第二参数（`'sword'`、`'pickaxe'`、`'helmet'` 等），默认 basic；食物用 `.food(food => ...)`，不是 type。
- id 规则：合法 `ResourceLocation`（小写 `a-z0-9/._-`，可有 `namespace:`）；不写命名空间默认 `kubejs:`。注册 id 不可重复。
- 纹理必须另给 PNG：默认路径 `assets/kubejs/textures/item/<path>.png`；KubeJS 生成 item model，但不生成纹理。也可 `.texture('minecraft:item/diamond')` 复用原版。
- 翻译 key：`item.kubejs.<path>`；中文放 `assets/kubejs/lang/zh_cn.json`。
- 物品注册是 startup 事件，**改物品/加物品必须重启游戏**；`/kubejs reload startup-scripts` 只重跑脚本，不会重新注册已存在的物品。[item-registry](https://kubejs.com/wiki/tutorials/item-registry) · [StartupEvents.java](https://github.com/KubeJS-Mods/KubeJS/blob/2101/src/main/java/dev/latvian/mods/kubejs/plugin/builtin/event/StartupEvents.java)

### 2.4 自定义配方（server）

```js
// kubejs/server_scripts/recipes.js
ServerEvents.recipes(event => {
  event.shaped('kubejs:lore_page', [
    'PPP',
    'PBP',
    'PPP'
  ], { P: 'minecraft:paper', B: 'minecraft:ink_sac' })
    .id('blockworkshop:lore_page')           // 固定 recipe id，Patchouli 页才能引用
})
```

- `event.shaped` / `shapeless` / `smelting` / `blasting` / `smoking` / `campfireCooking` / `stonecutting` / `smithing` 都可用；配方脚本放 `server_scripts/`。
- `.id()` 接收资源位置；若省略，KubeJS 自动生成 id，**不要**让 Patchouli `patchouli:crafting` 依赖不确定的自动 id。
- 更稳的做法：配方直接写成 `kubejs/data/<ns>/recipe/<id>.json`（1.21.1 是单数 `recipe`），id 即文件路径，Patchouli 直接引用；KubeJS 的 `data` 会加载它。
- 来源：[recipes](https://kubejs.com/wiki/tutorials/recipes) · [KubeRecipe.id](https://github.com/KubeJS-Mods/KubeJS/blob/2101/src/main/java/dev/latvian/mods/kubejs/recipe/KubeRecipe.java)

### 2.5 kubejs/data 到底能干什么

- ✅ 能：`recipe`、`advancement`、`loot_table`、`tags`、`function`、`predicate`、结构、RPG Dialogue 的 `dialogues/`、VNDialog 的 `dialog/dialogs/` 等**普通数据包内容**；`/reload` 生效。
- ❌ 不能：让 Patchouli 发现新书。书注册不走数据包（见 1.1）；把 `book.json` 放 `kubejs/data` 不会出现在书列表。
- ⚠️ 不能：给 external book 提供正文。external loader 只读实例根目录；PR #849 合并前，KubeJS assets 只能放图片/lang/声音。
- 首启：KubeJS 首次运行会在实例根生成 `kubejs/` 和示例；也可以提前写好目录，KubeJS 会直接加载。启动脚本只跑一次；server scripts 进世界/`/reload`；资源改完按 F3+T。

## 3. 剧情/对话方案对比（1.21.1 NeoForge，2026-10）

| 方案 | 1.21.1 NeoForge | 形态/可生成性 | 结论 |
|---|---|---|---|
| **RPG Dialogue** `rpg-dialogue` 1.0.11 | ✅ 2026-10-15 | 纯 datapack JSON：`data/<ns>/dialogues/*.json` + `dialogue_speakers/*.json`；pages/choices/conditions/actions；右击或 `/dialogue` | **生成器首选**；分支、条件、给物品/执行命令都齐全；无自定义 NPC 模型，绑定现有实体 |
| **Easy NPC** `easy-npc` 7.16.0（Bundle，含 Core+Config UI） | ✅ 2026-10-17 | 游戏内 GUI 建 NPC/对话树；预设可导出 `.npc.snbt`，data pack 可加载预设 | NPC 外观/皮肤/对话一站式；**对话不在独立 JSON 里，生成器只能生成预设或命令，主要人工** |
| **VNDialog** `nvdialog` 1.0.6 | ✅ 2025-06-05 | Galgame 立绘/分支 JSON；固定 namespace `dialog`，路径 `data/dialog/dialogs/*.json`；`/dialog reload`、`/dialog show` | 视觉最强；更新慢、命名空间写死；适合“立绘对话”型剧情，需资源包立绘/音频 |
| **Aviel's Dialogue Mischiefs** 0.8.5 | ✅ 2026-09-15（仅 NeoForge） | JSON 分支 + 自带 NPC；对话在 `data/<ns>/adm_dialogues/dialogues/`，NPC 模板在 `config/adm-dialogues/npc_templates/` | 功能对口、生成友好；下载量很小（≈333），⚠️ 实验性，需实测 |
| **CustomNPCs-Unofficial** | ⚠️ 2026-01-03 NeoForge 构建；Modrinth 上 NeoForge 仅 2024-12 | 游戏内编辑器、对话/任务/脚本；数据在世界存档 | 功能最全但非官方、NeoForge 构建旧；**不建议新项目**。原版 CurseForge 最新只到 1.16.5 |
| **MCA Reborn** 7.7.36 | ✅ 2026-08-16 | 村民社交/婚姻/对话；MCA Conversations 1.8.0 加深对话 | 生活感/氛围好，但不是作者可控的分支剧情树；⚠️ 不适合做主叙事 |
| **Guard Villagers** 2.4.12 | ✅ 2026-08-30 | 守卫村民战斗 AI | ❌ 无对话，仅战斗 |
| **Recruits** | ❌ | CurseForge 最新 1.20.1 Forge；无 1.21.1 NeoForge | ❌ 不可用 |
| **FTB Quests** 2101.1.36 | ✅ 2026-09-15 | 任务树/章节 SNBT；description 是 `List<String>`，每行可 raw JSON text，`{@pagebreak}` 分页 | 承载长叙事/多页/富文本；分支靠任务依赖，**不是逐句对话** |

- **FTB Quests 能承载多少**：`Quest.getRawDescription()` 是字符串列表，`TextUtils.parseRawText` 支持原版 JSON text（颜色、click/hover）或 FTB 旧式格式；`{@pagebreak}` 把描述切成多页。适合章节前言、任务说明、世界观长文；不适合角色对白/选项。[Quest.java](https://github.com/FTBTeam/FTB-Quests/blob/1.21.1/main/common/src/main/java/dev/ftb/mods/ftbquests/quest/Quest.java) · [TextUtils.java](https://github.com/FTBTeam/FTB-Quests/blob/1.21.1/main/common/src/main/java/dev/ftb/mods/ftbquests/util/TextUtils.java)
- **Patchouli 是否适合叙事**：适合“设定集/法典/人物志/图鉴”，可用 text/image/entity/relations 做沉浸式阅读；没有对话状态机，`$(c:/...)` 只能做很笨的假选择。建议“Patchouli 讲世界，对话 mod 演剧情”。

### 推荐组合

1. **最低成本（稳定优先）**：Patchouli（external 书）+ KubeJS（物品/配方）+ Easy NPC（NPC 与对话，游戏内配）。全部 1.21.1 NeoForge 活跃；书和物品可全自动导出，NPC/对话需人工。适合先跑通闭环。
2. **叙事效果最好（生成器友好）**：Patchouli（设定集）+ **RPG Dialogue**（分支对话/条件/动作）+ KubeJS。对话全在 datapack JSON，生成器可直接写；人物用原版村民或 Easy NPC 提供外观（⚠️ 两者右击拦截需实测）。追求 Galgame 立绘则把 RPG Dialogue 换成 VNDialog，但接受固定 `dialog` 命名空间和 2025 年后更新慢。
3. **可维护/长线**：Patchouli + FTB Quests + Easy NPC。FTB 有成熟编辑器、章节图、任务依赖和团队协作；Patchouli 负责设定，Easy NPC 负责人物；生成器只铺文本/物品，布局在游戏内做。适合内容团队长期迭代。

## 4. 生成器实现清单

| 产物 | 生成文件 | 最小字段 | mrpack 落点 | 人工 |
|---|---|---|---|---|
| Patchouli 书 | `book.json` | `name`、`landing_text`；建议 `creative_tab`、`book_texture`、`model`、`use_resource_pack:false` | `overrides/patchouli_books/<book>/book.json` | 首次进游戏确认；新增 book.json 要重启 |
| 分类 | `en_us/categories/<id>.json` | `name`、`description`、`icon`；可选 `sortnum`、`parent` | 同上目录 | 选图标/排序 |
| 条目 | `en_us/entries/<path>.json` | `name`、`icon`、`category`（全限定）、`pages`；可选 `advancement`、`sortnum`、`priority`、`secret`、`read_by_default`、`turnin`、`extra_recipe_mappings` | 同上 | 锚点/页序检查 |
| 页面 | 嵌在 entry 的 `pages[]` | text 的 `text`；image 的 `images`；crafting 的 `recipe`；spotlight 的 `item` | 同上 | 图片素材 |
| 中文覆盖 | `zh_cn/...` 同相对路径 | 只覆盖 `en_us` 已有 id | 同上 | 翻译；不能新增 id |
| 物品脚本 | `startup_scripts/<name>.js` | `event.create('<id>')`；建议 `.texture()`、`.displayName()` | `overrides/kubejs/startup_scripts/` | 加物品必须重启 |
| 物品纹理 | `<id path>.png` | 16×16 PNG（或复用原版） | `overrides/kubejs/assets/kubejs/textures/item/<path>.png` | 美术 |
| 物品 lang | `zh_cn.json` / `en_us.json` | `item.kubejs.<path>` | `overrides/kubejs/assets/kubejs/lang/` | 翻译 |
| 配方（脚本） | `server_scripts/<name>.js` | `ServerEvents.recipes` + `.id('<ns>:<id>')` | `overrides/kubejs/server_scripts/` | `/reload` |
| 配方（静态） | `data/<ns>/recipe/<id>.json` | 原版 1.21.1 recipe JSON | `overrides/kubejs/data/<ns>/recipe/` | `/reload` |
| 书发放 | `data/<ns>/advancement/grant_book.json`、`data/<ns>/loot_table/grant_book.json` | `minecraft:tick` + `minecraft:set_components` 的 `patchouli:book` | `overrides/kubejs/data/<ns>/` | 进世界触发一次 |
| RPG Dialogue | `data/<ns>/dialogues/<id>.json`、`data/<ns>/dialogue_speakers/<id>.json` | 对话 `pages`/`choices`；speaker `entity`+`dialogue` | `overrides/kubejs/data/<ns>/` | 绑实体、测试条件 |
| VNDialog | `data/dialog/dialogs/<id>.json` | `id`、`start`、`entries`（`id`/`text`，可选 `options`） | `overrides/kubejs/data/dialog/dialogs/` | `/dialog reload`；立绘/音频资源包 |
| Easy NPC | 无独立对话 JSON；可选 `.npc.snbt` 预设 | 用 GUI 建 NPC/对话树，再 `preset export` | `overrides/config/easy_npc/preset/` 或数据包（按 wiki） | **必须游戏内做**：皮肤、对话、放置 |
| FTB Quests | `config/ftbquests/quests/**/*.snbt` | 章节/任务/依赖/description | `overrides/config/ftbquests/quests/` | **布局/图标/依赖建议游戏内编辑器** |
| 图片/声音 | 资源位置对应文件 | `assets/<ns>/textures/...`、`sounds/...` | `overrides/kubejs/assets/<ns>/...` | 美术/音频/授权 |

### 必须人工完成

- **Easy NPC 的 NPC 与对话**：在游戏内建/配，导出预设；生成器无法可靠生成其 NBT 对话树。
- **FTB Quests 的章节布局**：坐标、图标、依赖线、章节图；生成器可写 SNBT，但排版仍以编辑器为准。
- **RPG Dialogue / VNDialog 的实体绑定与放置**：`dialogue_speakers` 只能按实体类型/标签绑定，具体 NPC 落点、皮肤、名字需人工。
- **Patchouli 图片/自定义书皮/模型**：KubeJS assets 或资源包；书 JSON 只能引用资源位置。
- **最终游戏内验收**：新 book.json 需重启；KubeJS 新物品需重启；Patchouli 正文改完可用书内铅笔重载；`/reload` 只验证脚本/数据包；F3+T 验证 assets。

### 关键操作命令

```mcfunction
# 给书（1.21.1 组件语法）
/give @p patchouli:guide_book[patchouli:book="patchouli:blockworkshop_guide"]
# KubeJS 重载（注意命令是连字符）
/reload
/kubejs reload server-scripts
/kubejs reload startup-scripts
```

## 5. 主要来源

- Patchouli 文档： [getting-started](https://vazkiimods.github.io/Patchouli/docs/patchouli-basics/getting-started/) · [book-json](https://vazkiimods.github.io/Patchouli/docs/reference/book-json/) · [entry-json](https://vazkiimods.github.io/Patchouli/docs/reference/entry-json/) · [page-types](https://vazkiimods.github.io/Patchouli/docs/patchouli-basics/page-types/) · [text-formatting](https://vazkiimods.github.io/Patchouli/docs/patchouli-basics/text-formatting/)
- Patchouli source： [BookRegistry](https://github.com/VazkiiMods/Patchouli/blob/release-1.21.1-93/Xplat/src/main/java/vazkii/patchouli/common/book/BookRegistry.java) · [BookFolderLoader](https://github.com/VazkiiMods/Patchouli/blob/release-1.21.1-93/Xplat/src/main/java/vazkii/patchouli/common/book/BookFolderLoader.java) · [Issue #355](https://github.com/VazkiiMods/Patchouli/issues/355) · [PR #849](https://github.com/VazkiiMods/Patchouli/pull/849)
- KubeJS 文档： [folder-data](https://kubejs.com/wiki/folder-structure/data) · [folder-assets](https://kubejs.com/wiki/folder-structure/assets) · [item-registry](https://kubejs.com/wiki/tutorials/item-registry) · [recipes](https://kubejs.com/wiki/tutorials/recipes)
- 对话/任务： [RPG Dialogue wiki](https://wiki.pixeldreamstudios.net/mods/rpg-dialogue) · [Easy NPC wiki](https://github.com/MarkusBordihn/BOs-Easy-NPC/wiki) · [VNDialog](https://modrinth.com/mod/nvdialog) · [FTB Quests source](https://github.com/FTBTeam/FTB-Quests/tree/1.21.1/main) · [Aviel](https://modrinth.com/mod/aviel-dialogue-mod) · [MCA Reborn](https://modrinth.com/mod/minecraft-comes-alive-reborn)
- mrpack 覆盖目录： [Modrinth 支持文档](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack)
