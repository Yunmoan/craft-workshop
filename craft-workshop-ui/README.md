# 方块工坊 Web UI（`@ipthmc/craft-workshop-ui`）

「方块工坊 CraftWorkshop」的 DSH Web 管理器：在 **设置 → 方块工坊** 下提供 5 个页面。

| 页面 | 功能 |
|---|---|
| **概览** | 工程卡片（名称/版本/目标 MC+加载器/官网）、模组/设计/构建/服务端统计、设计校验问题、导出状态、最近构建、操作历史；「导出全部」「构建整合包」快捷按钮 |
| **模组管理器** | 模组清单表格（名称/版本/双端支持/锁定状态）+ 添加（slug 或 slug@versionId）+ 移除 + 解锁 + 依赖解析与警告 |
| **设计管理器** | 8 类设计（人物/势力/地点/世界观/剧情/任务/物品/配方）列表 + JSON 编辑器 + 新建/保存/删除 + 全量校验（字段与交叉引用） |
| **构建与导出** | 四种导出（设计文档 / FTB Quests / Patchouli / KubeJS）逐项或一键、构建整合包、导出状态表、构建产物列表、操作日志 |
| **服务器管理器** | 服务端 mods 数、应安装文件数、缺失/哈希不匹配、检查一致性、同步安装、备份服务端、生成服务端配置、状态探测（SRV）、备份列表 |

## 数据来源与操作

浏览器端只调用 Host 插件 `@ipthmc/craft-workshop` 的**本机管理接口**：

```
GET  /craft-workshop/api/state      GET  /craft-workshop/api/server
GET  /craft-workshop/api/mods        POST /craft-workshop/api/mods
GET  /craft-workshop/api/design      POST /craft-workshop/api/design
POST /craft-workshop/api/export      POST /craft-workshop/api/build
GET  /craft-workshop/api/backups     GET  /craft-workshop/api/history
```

编辑类操作（写设计内容、改模组清单、导出、构建、安装、备份）都由这些接口完成；Agent 侧的 `mc_*` 工具走同一套管理器实现，两种入口行为一致。

## 约束

- 只使用 Harness 主题 token（`--dsw-alias-*`），不引入 Harness Client 包，不向 `document.body` 追加内容。
- 所有注册放在 `apply` 内，随插件卸载回收；页面为只读渲染 + 本机操作按钮。
- POST 接口只接受本机（loopback）请求。
