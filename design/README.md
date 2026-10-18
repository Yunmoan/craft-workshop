# 设计内容目录

这是整合包的内容源（source of truth）：剧情、任务、人物、势力、地点、世界观、物品与配方。
所有条目都是 JSON 文件，路径为 `design/<kind>/<id>.json`；推荐通过 Agent 的 `mc_design` 工具增删改查，或直接编辑 JSON。

| kind | 目录 | 说明 |
|---|---|---|
| `character` | `characters/` | 人物设定：角色档案：身份、性格、背景、关系网、正文档案。`faction` 引用 faction id；`relationships[].character` 引用 character id。 |
| `faction` | `factions/` | 势力/派系：势力、种族、神明体系等。`leader` 引用 character id；`allies`/`enemies` 引用 faction id。 |
| `location` | `locations/` | 地点/地图：地点、区域、建筑、副本。`region` 可为上级地点 id；`coordinates` 为游戏内坐标或维度描述。 |
| `lore` | `lore/` | 世界观条目：世界观设定条目：创世、历史、魔法体系、种族、宗教等。`category` 用于分组（history/magic/religion…）。 |
| `story_chapter` | `story/` | 剧情章节：线性/分支剧情章节。`characters`/`factions`/`locations` 引用对应 id；`questChapter` 绑定任务章节 id；`body` 为章节正文（Markdown，可用 ## 场景分隔）。 |
| `quest_chapter` | `quests/` | 任务章节：任务章节，导出为 FTB Quests。`quests[]` 每项：id、title、subtitle、description、x、y、dependencies（任务 id）、tasks、rewards。任务类型 item/kill/checkmark/advancement/stat/observation；奖励类型 item/xp/command/loot/choice。 |
| `item` | `items/` | 物品设计：自定义物品设计（可导出 KubeJS 注册草稿）。`namespace` 默认 inherit 项目；`recipe` 引用 recipe id。 |
| `recipe` | `recipes/` | 配方设计：自定义配方设计。`type` 为 shaped/shapeless/smelting/smithing/custom；output/inputs 可为物品设计 id（导出时替换为物品 id）或 `namespace:item` 原版/模组物品。 |

## 工作流

1. `mc_design action=write kind=character id=xxx data={...}` 编写内容；
2. `mc_design action=check` 校验字段与交叉引用；
3. `mc_export target=all` 导出 FTB Quests / Patchouli / KubeJS / 设计文档；
4. `mc_build` 从 `project.json` 构建 `.mrpack`。

## 模板

`design/_templates/` 下为每种类型的空白模板（不会被校验或导出）。
