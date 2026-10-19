# 永世幻想间 IPTHMC

> IPTHMC 社团的 Minecraft 整合包 + 服务器运营项目。
> 官网：<http://IPTHMC.zyghit.cn> ｜ 目标版本：**Minecraft 1.21.1 / NeoForge / Modrinth `.mrpack`**

本工作区是**整合包创作工程**，配套 DSH 插件「方块工坊 CraftWorkshop」：让 Agent 帮你编辑工程、写剧情/任务/人物等设计、导出游戏格式、构建整合包——而不是替你"一键生成一个包"。

## 目录结构

| 路径 | 内容 |
|---|---|
| [`project.json`](project.json) | **工程文件（唯一事实源）**：目标版本、模组清单、overrides、内容导出映射、输出目录 |
| [`design/`](design) | **设计内容源文件**：剧情/任务/人物/势力/地点/世界观/物品/配方（JSON，见 [设计说明](design/README.md)） |
| [`overrides/`](overrides) | 手工维护、原样进包的文件（config、kubejs、资源包等） |
| [`build/exports/`](build/exports) | `mc_export` 生成的游戏文件与设计 wiki（不要手改） |
| [`builds/`](builds) | 构建出的 `.mrpack`（输出产物） |
| [`craft-workshop/`](craft-workshop) | DSH 插件「方块工坊」Host 半源码（14 个工具，零依赖，已安装到当前 profile） |
| [`craft-workshop-ui/`](craft-workshop-ui) | DSH 插件「方块工坊」Web 半（设置页面板：工程/设计/导出/构建状态） |
| [`docs/AUTHORING.md`](docs/AUTHORING.md) | **创作工作流手册**（数据模型、导出格式、注意事项） |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | 服务端部署与运营手册 |
| [`docs/research/`](docs/research) | 调研资料：MC API、整合包/服务端配置、FTB Quests 格式、内容栈 |
| [`server/`](server) · [`proxy/`](proxy) | NeoForge/Arclight 服务端与 Velocity 代理骨架（运维用） |

## 当前状态（2026-10-18）

**Web UI 管理器（设置 → 方块工坊）**
- ✅ 五个管理器页面：**概览** / **模组** / **设计** / **构建** / **服务器**。
- ✅ 概览页展示工程摘要、设计统计与校验问题、导出状态、最近构建、操作历史，并提供「导出全部 / 构建整合包」按钮。
- ✅ 模组管理器支持添加/移除/解锁模组与依赖解析；设计管理器支持 8 类设计的列表/JSON 编辑/新建/删除/全量校验；构建页支持四种导出与构建；服务器页支持一致性检查、同步安装、备份、生成配置与状态探测。
- ✅ 全部操作走 Host 的**本机管理接口** `/craft-workshop/api/*`（写操作限制 loopback），与 Agent 的 `mc_*` 工具共用同一套管理器实现。

**制作工具**
- ✅ 插件「方块工坊 CraftWorkshop」（`@ipthmc/craft-workshop`）已安装激活。
- ✅ 工程驱动：`mc_project` / `mc_mods` / `mc_build`——模组清单与构建配置写在 `project.json`，构建产物只是输出。
- ✅ 设计内容系统：8 类设计（剧情/任务/人物/势力/地点/世界观/物品/配方）的增删改查 + 交叉引用校验 + 设计 wiki 导出。
- ✅ **FTB Quests 导出器**：按 2101.1.36 源码与 ATM-10 真实数据核对，生成 `data.snbt` / `chapter_groups.snbt` / `chapters/*.snbt` / `lang/zh_cn.snbt`（16hex ID、任务依赖、文本外置）。
- ✅ **Patchouli 指南书导出器**：人物志/世界设定/地点图鉴/物品图鉴 → external book，落到 `overrides/patchouli_books/ipthmc_guide/`（Patchouli 只认实例根目录，不走数据包）。
- ✅ **KubeJS 导出器**：物品设计 → `startup_scripts/craftworkshop_items.js`；配方设计 → `data/<ns>/recipe/*.json` 静态配方（可被 Patchouli 合成页引用）。
- ✅ 四种导出已实测：同一工程可一次导出 FTB Quests + Patchouli + KubeJS + 设计 wiki，并全部打进 `.mrpack`（构建产物已验证内容映射路径）。
- ℹ️ `design/` 当前为空（模板在 `design/_templates/`），内容由项目组创作。

**服务器侧（前一轮完成）**
- ✅ `mc_server_config` 生成 NeoForge / Arclight / Velocity 骨架；`mc_pack_install` / `mc_pack_check` 同步并校验服务端 mods。
- ⚠️ 本机未装 Java，服务端未实际启动验证；`ipthmc.zyghit.cn:25565` 当前探测无响应且无 SRV 记录（需确认实际 MC 地址）。

## 快速开始（让 Agent 执行）

1. `mc_project action=show` 看工程状态；`mc_project action=init` 初始化目录。
2. `mc_mods action=add refs=["..."]` 加模组；`mc_mods action=resolve` 检查依赖。
3. `mc_design action=write kind=character id=... data={...}` 写人物/剧情/任务；`mc_design action=check` 校验。
4. `mc_export target=all` 导出 FTB Quests / 设计 wiki（Patchouli/KubeJS 导出器完成后自动启用）。
5. `mc_build` 构建 `.mrpack` 到 `builds/`。
6. `mc_pack_install` / `mc_pack_check` 同步并校验服务端。

## 安全与合规

- `eula.txt` 中 `eula=true` 代表同意 Minecraft EULA（<https://aka.ms/MinecraftEULA>）。
- `forwarding.secret`、RCON 密码、CurseForge API Key 等属于凭据，不要提交公开仓库。
- 剧情/人物/势力等创作内容的版权合规由项目组确认；模组/资源包遵循各自许可。

## 推送到 GitHub

仓库：**`Yunmoan/craft-workshop`**（public）。本地已初始化并提交，授权后一键推送：

```bash
./scripts/push-github.sh
```

登录/授权步骤见 [docs/PUBLISH.md](docs/PUBLISH.md)（SSH 公钥已生成在 `.gitkeys/`，勿提交私钥）。

## 下一步

见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。近期优先：
1. 完成 Patchouli / KubeJS 导出器（人物志/设定集/自定义物品配方）。
2. 真实客户端验证 FTB Quests 任务书加载。
3. 正式内容创作：替换 `demo-*` 示例，建立世界观与主线任务。
4. 是否需要 DSH Web UI 创作面板（设计内容可视化编辑）。
