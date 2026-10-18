# FTB Quests 数据格式调研（MC 1.21.1 / NeoForge）

> 2026-10-18 抓取。源码证据来自 `FTBTeam/FTB-Quests` 的 `1.21.1/main` 与 CurseForge 发行版 `-sources.jar`（两者一致）；数据样本来自真实包 `AllTheMods/ATM-10`（1.21.1 NeoForge）。`⚠️`=未实测，仅源码/链接推断。
> 源码根：`https://raw.githubusercontent.com/FTBTeam/FTB-Quests/1.21.1/main/common/src/main/java/dev/ftb/mods/ftbquests/`
## 1. 版本确认

| 项 | 结论 | 证据 |
|---|---|---|
| Modrinth | **无本体**（`ftb-quests`/`ftbquests` 均 404），只有附属模组 | `api.modrinth.com/v2/project/ftb-quests` |
| CurseForge | **289412**（NeoForge）/ 438496（Fabric） | `api.cfwidget.com/289412`、`gradle.properties` |
| 1.21.1 最新版 | **2101.1.36**（2026-09-15，file 8885017，Client+Server） | cfwidget `files[]` |
| 源码分支 | `1.21.1/main` → `mod_version=2101.1.36`；`1.21.1/dev`=2101.1.37 未发布 ⚠️ | `raw…/1.21.1/main/gradle.properties` |
| 依赖 | NeoForge 21.1.213、FTB Library/Teams 2101.1.x、Architectury 13 | 同上 |
| 存储格式 | SNBT 目录树；`data.snbt` 内 `version: 13`（`BaseQuestFile.VERSION=13`） | `quest/BaseQuestFile.java:68` |
| 注意 | MC 26.1 的 `main` 分支已改 **JSON5**，与本目标无关，勿混用 | `raw…/main/…/BaseQuestFile.java` |

FTB Quests 只发 CurseForge + FTB Maven：`https://maven.ftb.dev/releases/dev/ftb/mods/ftb-quests/2101.1.36/`（含 `-sources.jar`）。
## 2. 真实目录结构（raw 证据）

`https://api.github.com/repos/AllTheMods/ATM-10/contents/config/ftbquests/quests`（章节样本：`raw.githubusercontent.com/AllTheMods/ATM-10/main/config/ftbquests/quests/chapters/integrated_dynamics.snbt`）：

```
config/ftbquests/quests/
├── data.snbt                      # 书级设置（含 version: 13）
├── chapter_groups.snbt            # 章节组列表
├── chapters/<filename>.snbt       # 一章节一文件（ATM-10 67 个）
├── reward_tables/<filename>.snbt  # 奖励表（ATM-10 61 个）
└── lang/<locale>.snbt             # 全部文本
```

- **没有 `quest_links.snbt`**：连线写在章节文件的 `quest_links` 列表里（`BaseQuestFile.writeChapterFiles`）。
- 加载路径：`Platform.getConfigFolder().resolve("ftbquests/quests")`（`quest/ServerQuestFile.java:83`）；玩家进度另存 `world/ftbquests/*.snbt`，不在 `config/`。
- ⚠️ 坑：ATM-10 仓库里的 `lang/en_us/`（`chapter.snbt`、`chapters/*.snbt`…）是第三方 "FTB Quests Lang Splitter" 的**翻译工程目录**；游戏只读扁平的 `lang/en_us.snbt`。其 `.gitignore` 写明 `# ignore original lang files like en_us.snbt`。照抄会丢文本。
## 3. 文件与字段

**`data.snbt`**：`{ version: 13, default_quest_shape: "circle", default_autoclaim_rewards: "disabled", fallback_locale: "en_us", progression_mode: "flexible", grid_scale: 0.5d, icon: {id:"…"} }`。枚举：`default_autoclaim_rewards`∈`default/disabled/enabled/no_toast/invisible`；`progression_mode`∈`default/linear/flexible`。最小可只写 `{ version: 13 }`（缺省 shape=circle、progression=linear、detection_delay=20、fallback=en_us）。

**`chapter_groups.snbt`**（默认组不列；组标题在 lang）：
```snbt
{
	chapter_groups: [
		{ id: "2084F3F6FB861C5B" }
	]
}
```

**章节 `chapters/<filename>.snbt`**：
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 16 hex 字符串 | 全局唯一 |
| `filename` | string | 小写无扩展名，**必须等于磁盘文件名** |
| `group` | string | 组 ID；`""`=默认组 |
| `order_index` | int | 组内排序，从 0 |
| `icon` | compound | 物品栈 `{ id: "ns:item" }`，可带 `count`/`components` |
| `default_quest_shape` / `default_quest_size` | string/double | `""`=继承；size≠1.0 才写 |
| `default_hide_dependency_lines` / `progression_mode` / `hide_quest_until_deps_*` / `require_sequential_tasks` / `always_invisible` | 可选 | 布尔默认值省略 |
| `quests` / `quest_links` / `images` | list | link=`{id, linked_quest, x, y}`；image=`{id, image, x,y,width,height,rotation}` |

**quest 对象（`quests[]`）**：
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 16 hex | 全局唯一 |
| `x` / `y` | double | 画布坐标，0.5 对齐，必写 |
| `shape` | string | 省略=继承章节；`square/circle/diamond/gear/heart/hexagon/octagon/pentagon/rsquare/none` |
| `size` | double | 0.0625–8，1.0 省略 |
| `icon` | compound | 物品栈 |
| `dependencies` | list<string> | 前置 quest/quest_link 的 hex ID，**可跨章节**（ID 全库唯一） |
| `dependency_requirement` | string | `all_completed`(默认省略)/`one_completed`/`all_started`/`one_started` |
| `min_required_dependencies` / `hide_dependency_lines` / `optional` / `can_repeat` / `invisible*` / `guide_page` / `min_width` | 可选 | |
| `tasks` / `rewards` | list | 为空则整键省略 |

跨章节实测（ATM 全库 18 处）：`dependencies: ["5151CDD8FCDE7A07"]`；旧版 int 数组仍可读（`Quest.readData` 的 `contains("dependencies",11)` 分支）。

**`reward_tables/<filename>.snbt`**：`{ id, order_index, loot_size, empty_weight?, hide_tooltip?, use_title?, rewards:[…], loot_crate?, loot_table_id? }`。`rewards[]` 每项是奖励对象，**item 类型省略 `type`**，`weight` 只在≠1.0 时写。表标题：`reward_table.<id>.title`。
## 4. ID 规则（最容易踩雷）

- 形态：**16 位大写 hex 字符串**（`String.format("%016X", id)`），如 `"499CF9F39CED8899"`。
- 解析：`Long.parseLong(hex,16)`（允许前导 `#`）。因此 **首位只能是 `0`–`7`**；`8`–`F` 会异常→返回 0→静默换随机 ID 并标脏。
- 保留位：`0`、`1`（`1` 是 file 自身）及任何**重复** ID 都会被 `readID()` 重新随机分配。
- ID 空间全库共用：章节组、章节、quest、task、reward、quest_link、image、reward_table、表内 reward 互不重复。
- 文件名由 `filename` 字段经 `sanitizeFilename`（小写、空格→`_`、去 `\W`）生成；2101.1.33 起加载时会把 `chapters/`、`reward_tables/` 里的文件名强制改小写（旧文件留 `.OLD`）。
- `loot/random/choice` 引表用 `table_id: <十进制 long>L`（如 `4196188979167302596L`），**不是 hex**。
## 5. 文本（2026 现行格式）

2100.1.0 起文本移出 SNBT，存 `lang/<locale>.snbt`。键=`<objectType>.<16hex>.<subKey>`（`TranslationManager.makeKey`）：

| 对象 | 键 | 值 |
|---|---|---|
| 全书 | `file.0000000000000001.title` | string |
| 章节组 | `chapter_group.<id>.title` | string |
| 章节 | `chapter.<id>.title` / `.chapter_subtitle` | string / list |
| quest | `quest.<id>.title` / `.quest_subtitle` / `.quest_desc` | string / string / **list** |
| task / reward / 奖励表 | `task.<id>.title`、`reward.<id>.title`、`reward_table.<id>.title` | string |

真实扁平样本（ATM-10 tag 2.29 的 `lang/en_us.snbt`）：`chapter.007B547630FF0478.title: "Theurgy"`、`quest.1568CBFA09827137.quest_desc: ["…"]`、`quest.232A06C9FF0EE7B2.quest_subtitle: "Automating Menril"`。键是**含点的裸键**（不带引号，真实文件如此）。
- description：列表每个元素=一段/一行；元素恰为 `"{@pagebreak}"` 时切页（`Quest.PAGEBREAK_CODE`）；行内换行用 `\n` 转义；支持 `&l` `&r` `&c` `&d` 等旧格式码，整段也可写 vanilla JSON 文本（`util/TextUtils.parseRawText` 先试 JSON 再回退）。
- 语言回退：缺键回退 `data.snbt` 的 `fallback_locale`（默认 `en_us`）。
- 兼容内联：`handleLegacyChapterNBT/QuestNBT/TaskNBT` 仍读章节/quest/task 的 `title`、`subtitle`、`description` 并**自动迁移**进 `lang/en_us.snbt`+`markDirty()`（2100.1.1 日志明确）；**reward 的旧内联 title 不迁移**。
## 6. 任务类型（`tasks[]`，公共 `id`/`type`，可选 `optional_task`）

`TaskTypes`：`item / custom / xp / dimension / stat / kill / location / checkmark / advancement / observation / biome / structure / gamestage / fluid`。

| type | 专有字段 |
|---|---|
| `item` | `item`(物品栈)、`count`(long，>1 才写)、`consume_items`、`only_from_crafting`、`match_components`、`task_screen_only` |
| `kill` | `entity`、`value`(long)、`custom_name`、`nbt_filter`、`entityTypeTag`(驼峰) |
| `checkmark` | 无 |
| `advancement` | `advancement`、`criterion`(`""`=整个进度) |
| `stat` | `stat`("minecraft:jump")、`value`(int) ⚠️ATM 无样本 |
| `observation` | `to_observe`、`timer`(long)、`observation_type`(`item/block/entity`)、`observe_type`(int，仍写出) |
| `dimension` / `biome` / `structure` | `dimension` / `biome` / `structure` |
| `location` | `dimension`、`ignore_dimension`、`position`[x,y,z]、`size`[w,h,d] |
| `xp` | `value`(long)、`points`(bool) |
| `fluid` | `fluid`(FluidStack compound；旧格式 `fluid` 字符串+`amount` long) |

```snbt
tasks: [{ count: 10L, id: "3677156DC4D715D5", item: { count: 1, id: "minecraft:glowstone" }, type: "item" }]
tasks: [{ entity: "aether:sheepuff", id: "127807B986E056CB", type: "kill", value: 1L }]
tasks: [{ id: "475245B27D3C9E93", type: "checkmark" }]
tasks: [{ advancement: "apotheosis:progression/haven", criterion: "", id: "76F3B5C3CB49DDBD", type: "advancement" }]
tasks: [{ id: "184097BB100F2D3B", observation_type: "block", observe_type: 0, timer: 0L, to_observe: "auroral:shimmer_soil", type: "observation" }]
```
## 7. 奖励类型（`rewards[]`，公共 `id`/`type`，可选 `auto`/`exclude_from_claim_all`）

`RewardTypes`：`item / choice / all_table / random / loot / command / custom / xp / xp_levels / advancement / toast / gamestage / currency`。

| type | 专有字段 |
|---|---|
| `item` | `item`、`count`(int，>1 才写)、`random_bonus`、`only_one` |
| `xp` / `xp_levels` | `xp`(int) / `xp_levels`(int) |
| `command` | `command`(可带前导 `/`)、`permission_level`(>0 才写)、`silent`、`feedback_message`；占位符 `{p}{x}{y}{z}{team}{quest}{chapter}{member_count}` 等 |
| `loot` / `random` / `choice` | `table_id`(十进制 long)；`table_data` 仅内联临时表；choice 的候选项=该奖励表 |
| `all_table` | 无 |
| `advancement` | `advancement`、`criterion` |
| `toast` | `description` |
| `gamestage` | `stage`、`remove` |
| `currency` | `amount`(int) |

```snbt
rewards: [{ count: 10, id: "10AF74A595D53CCD", item: { count: 1, id: "integrateddynamics:menril_planks" }, type: "item" }]
rewards: [{ id: "0920B905A30B389B", type: "xp", xp: 10 }]
rewards: [{ command: "/neovitae anima-network @p add 250", id: "3DDE40A2163CE301", permission_level: 3, type: "command" }]
rewards: [{ exclude_from_claim_all: true, id: "2A7EFCB386FBB78B", table_id: 4196188979167302596L, type: "loot" }]
rewards: [{ exclude_from_claim_all: true, id: "605122A4C0134016", table_id: 1234064663422651404L, type: "choice" }]
```
## 8. 最小自洽示例（1 组 + 1 章 + 3 quest，可直接照抄）

放 `overrides/config/ftbquests/quests/`。ID 已满足首位 0–7、全库唯一、非 0/1。

`data.snbt`
```snbt
{
	default_quest_shape: "circle"
	fallback_locale: "en_us"
	progression_mode: "flexible"
	version: 13
}
```

`chapter_groups.snbt`
```snbt
{
	chapter_groups: [
		{ id: "0A1B2C3D4E5F6071" }
	]
}
```

`chapters/chapter_1.snbt`
```snbt
{
	default_hide_dependency_lines: false
	default_quest_shape: ""
	filename: "chapter_1"
	group: "0A1B2C3D4E5F6071"
	icon: { id: "minecraft:crafting_table" }
	id: "1A2B3C4D5E6F7081"
	images: [ ]
	order_index: 0
	quest_links: [ ]
	quests: [
		{
			id: "2A2B3C4D5E6F7081"
			shape: "square"
			tasks: [{ count: 16L, id: "5A2B3C4D5E6F7081", item: { count: 1, id: "minecraft:oak_log" }, type: "item" }]
			rewards: [{ count: 8, id: "6A2B3C4D5E6F7081", item: { count: 1, id: "minecraft:bread" }, type: "item" }]
			x: 0.0d
			y: 0.0d
		}
		{
			dependencies: ["2A2B3C4D5E6F7081"]
			id: "3A2B3C4D5E6F7081"
			shape: "circle"
			tasks: [{ entity: "minecraft:zombie", id: "7A2B3C4D5E6F7081", type: "kill", value: 10L }]
			rewards: [{ id: "0B2B3C4D5E6F7081", type: "xp", xp: 50 }]
			x: 2.0d
			y: 0.0d
		}
		{
			dependencies: ["3A2B3C4D5E6F7081"]
			id: "4A2B3C4D5E6F7081"
			shape: "diamond"
			tasks: [{ id: "1C2B3C4D5E6F7081", type: "checkmark" }]
			rewards: [{ command: "/say 序章完成！", id: "2D2B3C4D5E6F7081", type: "command" }]
			x: 4.0d
			y: 0.0d
		}
	]
}
```

`lang/en_us.snbt`
```snbt
{
	chapter.1A2B3C4D5E6F7081.title: "序章"
	chapter_group.0A1B2C3D4E5F6071.title: "主线"
	quest.2A2B3C4D5E6F7081.quest_desc: ["用斧头砍下 16 个橡木原木。", "{@pagebreak}", "&7提示：任意木材都可以。"]
	quest.2A2B3C4D5E6F7081.title: "第一步：收集木材"
	quest.3A2B3C4D5E6F7081.quest_desc: ["夜晚的僵尸太多了。"]
	quest.3A2B3C4D5E6F7081.title: "清剿僵尸"
	quest.4A2B3C4D5E6F7081.quest_desc: ["确认已准备好，开始冒险。"]
	quest.4A2B3C4D5E6F7081.title: "启程"
}
```

不写 lang 时，把 `title`/`description: ["…"]`/`subtitle` 内联进章节/quest/task 也能被 2100.1.1+ 自动迁移（奖励标题除外），代价是首启重写文件。
## 9. 分发与首启行为

- **mrpack**：放 `overrides/config/ftbquests/quests/…`（`overrides/` 双端生效）。用 `server-overrides/` 会让单机玩家没任务书；用 `client-overrides/` 则专用服完全没有数据——服务端才是权威数据源。CurseForge 包同理走 `overrides/`。
- 两端都要装 FTB Quests（CurseForge 标 Client+Server）并保持同版本 2101.1.36 ⚠️；FTB Library、FTB Teams 为前置。
- **能否只靠 overrides 生效**：能。`ServerQuestFile.load()` 见目录即整棵读入；目录不存在则任务书为空（不报错）。单机由内置服读实例 `config/`，专用服读服务端根 `config/`。
- **首启重写/迁移**：① `version != 13` → `markDirty()`，下次保存全量重写（`writeDataFull`）；② 内联旧文本 → 迁移进 `lang/en_us.snbt` 并标脏；③ 章节/奖励表文件名大小写不符 → 加载时立刻改小写（旧文件留 `.OLD`）；④ 保存时 `SNBT.setShouldSortKeysOnWrite(true)`，键按字母排序、Tab 缩进、double 带 `d`、long 带 `L`（手写风格首次保存后被规范化）；⑤ `filename` 与磁盘名不一致 → 保存会另建一份，出现重复章节。
## 10. 生成器实现清单

| 文件 | 最小结构 | 何时生成 |
|---|---|---|
| `data.snbt` | `{ version: 13 }` | 总是；建议补 `fallback_locale`/`default_quest_shape`/`progression_mode` |
| `chapter_groups.snbt` | `{ chapter_groups: [ { id } … ] }` | 总是（无组写 `[ ]`，默认组不列） |
| `chapters/<file>.snbt` | `{ id, filename, group, order_index, quests:[…], quest_links:[ ], images:[ ] }` | 每章一个，文件名=小写 `filename` |
| `lang/en_us.snbt` | `{ "<type>.<ID>.<key>": value … }` | 有文本时；`quest_desc` 必须 list |
| `reward_tables/<file>.snbt` | `{ id, order_index, loot_size, rewards:[…] }` | 仅当用 loot/random/choice |

ID：用稳定键（`"quest:<chapter>:<slug>"`）取 sha256 前 8 字节，**清最高位**（`& 0x7FFF…`），`%016X`；拒绝 0/1 并做全库去重；依赖只存 hex；`table_id` 用同数值的十进制+L 后缀。
省略：布尔默认、`size`=1.0、`count`≤1、空 `shape`、空 `tasks/rewards`、默认 `dependency_requirement`、空文本键全部不写。
坐标：x 步长 2.0、y 步长 1.5–2.0，保持 0.5 对齐。
## 11. 未验证 / 风险

- ⚠️ 本文 §8 示例未经真实客户端加载（离线调研，无游戏环境）；字段均已对照 2101.1.36 源码与 ATM-10 真包样本。
- ⚠️ `lang` 裸键写法来自真实文件；"带引号的键"能否被 FTB Library SNBT parser 接受未测，建议照真实文件写裸键。
- ⚠️ 2101.1.37 仅在 dev 分支，上游发版后需按 `CHANGELOG.md` 复核 `version` 是否仍为 13；`ftbquests:custom_icon` / `image:` 图标组件结构未展开，第一版生成器建议只用普通物品 ID。
