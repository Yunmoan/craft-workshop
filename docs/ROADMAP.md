# ROADMAP — 方块工坊 / IPTHMC 创作工具

## 已完成 · 第一阶段：打包与运维工具

- [x] DSH Host 插件「方块工坊 CraftWorkshop」（`@ipthmc/craft-workshop`）安装激活。
- [x] Modrinth 搜索 / 资源详情 / 依赖闭包解析 / 加载器版本查询。
- [x] `.mrpack` 生成（含 overrides 三层）与服务端自动安装、一致性校验。
- [x] 服务端配置生成（NeoForge/Fabric/Paper/Velocity/Arclight）+ SLP 探活（SRV）。

## 已完成 · 第二阶段：整合包创作工具（authoring）

- [x] 工程文件模型 `project.json`（模组清单、目标版本、overrides、内容导出映射、输出目录）。
- [x] `mc_project` 工程管理、`mc_mods` 模组清单编辑、`mc_build` 工程驱动构建。
- [x] 设计内容系统：8 类设计（剧情/任务/人物/势力/地点/世界观/物品/配方）CRUD + 字段校验 + 交叉引用校验。
- [x] 设计文档（Markdown wiki）导出。
- [x] **FTB Quests 导出器**：按 2101.1.36 源码与 ATM-10 真实包核对（16hex ID、文本外置 lang、任务/奖励类型、跨章节依赖）。
- [x] 插件更名「方块工坊 CraftWorkshop」，IPTHMC 保留为社团名与包作用域。

## 已完成 · 第二阶段补充：内容导出器

- [x] **Patchouli 导出器**：external book（`overrides/patchouli_books/<book>/`），人物志/设定集/地点/物品图鉴 + 中文正文（en_us 扫描索引方案）。
- [x] **KubeJS 导出器**：物品注册 startup 脚本 + 静态配方 JSON（`data/<ns>/recipe/`），Patchouli 合成页可直接引用。
- [x] 一键导出四种产物（FTB Quests / Patchouli / KubeJS / 设计 wiki）并通过 `pack.content` 打进 `.mrpack`。

## 进行中 / 第三阶段候选

1. **FTB Quests 真实客户端验证**：修正任何加载期字段问题；支持奖励表（loot/random/choice）。
2. **对话/演出方案**：1.21.1 可用对话/NPC mod 选型，把 `story_chapter` 的场景与对白导出成游戏内演出。
3. **DSH Web UI 创作面板**：可视化编辑设计内容、预览任务树/关系网、一键导出与构建。
4. **版本管理与发布**：工程版本 diff、changelog 生成、Modrinth 发布辅助。
5. **多语言**：设计中英双语 → FTB Quests/Patchouli 的 zh_cn/en_us 双份导出。

## 需要项目组输入

- 正式模组策展方向与内容量级（决定导出器优先级）。
- 是否使用 Dialogue/NPC 类 mod（决定剧情演出导出器形态）。
- 服务器实际地址/端口（用于官网状态展示）。
- 是否需要中英双语版本（当前默认仅中文）。
