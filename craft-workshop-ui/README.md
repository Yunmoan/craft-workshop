# 方块工坊 Web UI（`@ipthmc/craft-workshop-ui`）

「方块工坊 CraftWorkshop」的 DSH Web 面板：在 **设置 → 方块工坊** 中展示整合包工程状态。

## 数据来源

浏览器端请求 Host 插件 `@ipthmc/craft-workshop` 提供的只读接口：

```
GET /craft-workshop/api/state
```

返回工程摘要、模组数量、8 类设计内容统计、校验问题、导出状态、最近构建与服务端 mods 数量。面板只读，编辑仍通过 Agent 的 `mc_*` 工具。

## 依赖

- Host 半：`@ipthmc/craft-workshop`（提供数据接口）
- Web 半（本包）：`client.js`，注册到 `settings.section`

## 说明

- 展示 UI 只使用 Harness 主题 token（`--dsw-alias-*`），不引入 Harness Client 包。
- 本包与 Host 插件分离，是因为客户端模块声明在安装后变更需要 Harness 重启才会被重新扫描；独立 bundle 可在运行中安装并加载。
