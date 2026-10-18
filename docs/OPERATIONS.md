# IPTHMC 部署与运营手册

> 适用：Minecraft 1.21.1 / NeoForge（模组服）+ Arclight（混合端备选）+ Velocity（代理）。
> 所有相对路径以工作区根目录为准。

## 0. 前置条件

- 服务端机器：Linux x86_64（推荐），**Java 21**（MC 1.20.5+ 要求），至少 4 核 / 8–12 GB 内存 / SSD。
- 开放端口：代理对外 `25577/tcp`（或直接用 25565 对外）；后端 `25565/tcp` 仅内网可达；按需开放 UDP（Geyser）。
- 本机开发环境可无 Java（生成配置不需要），但**真正启动服需要 Java**。

## 1. 首次生成（在工作区执行）

Agent 工具调用顺序（也可人工按生成文件操作）：

```
mc_resolve  → 校验依赖树
mc_pack     → packs/<name>-<versionId>.mrpack
mc_server_config kind=neoforge dir=server/neoforge
mc_server_config kind=velocity dir=proxy/velocity
mc_pack_install pack=packs/... serverDir=server/neoforge
mc_pack_check   pack=packs/... serverDir=server/neoforge
```

## 2. NeoForge 模组服部署

```bash
cd server/neoforge
# 1) 下载并安装 NeoForge（版本见 server.properties 同级的 user_jvm_args.txt 注释 / ipthmc.project.json）
#    https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.263/neoforge-21.1.263-installer.jar
java -jar neoforge-21.1.263-installer.jar --installServer
# 2) 启动（start.sh 会自动读取 user_jvm_args.txt 与 unix_args.txt）
./start.sh
```

- 内存改 `user_jvm_args.txt` 的 `-Xms/-Xmx`。
- `server.properties` 中 MOTD 已用 `\u` 转义（Java Properties 规范）；改中文 MOTD 后同样转义或直接用插件重新生成。
- `mods/` 由 `mc_pack_install` 维护；**不要手工改 jar**，否则 `mc_pack_check` 会报哈希不一致。

## 3. Arclight 混合端（模组 + 插件）

```bash
cd server/arclight
# 按 https://github.com/IzzelAliz/Arclight 的准备步骤安装对应 NeoForge 运行库，
# 再以 arclight-neoforge-1.21.1-1.0.1-8ec9529.jar 作为启动入口（start.sh 已写好）。
./start.sh
```

- `config/paper-global.yml` 只生成了 Velocity 转发所需的最小片段；首次启动由 Paper 补全。
- 与纯模组服二选一；Arclight 适合需要 Bukkit 插件（领地/经济/反作弊）的运营场景。

## 4. Velocity 代理联调（必须三处一致）

| 位置 | 配置 |
|---|---|
| `proxy/velocity/velocity.toml` | `player-info-forwarding-mode = "modern"`、`forwarding-secret-file = "forwarding.secret"`、`[servers]` 指向后端 |
| 后端 `server.properties` | `online-mode=false`（插件在 `settings.proxy.enabled=true` 时自动处理） |
| 后端 `paper-global.yml` | `proxies.velocity.enabled=true`、`online-mode: true`、`secret` 与 `forwarding.secret` 完全相同 |

- 密钥生成：`mc_server_config kind=velocity` 时输出并在备注里给出；给后端生成配置时通过 `settings.proxy.velocitySecret` 传入**同一个值**。
- 常见症状：改一处 → 进服即掉线 / 皮肤 UUID 错乱 / 后台显示离线。三处必须成组修改。
- 防火墙只暴露代理端口，后端 `25565` 绑定 `127.0.0.1`（`server.properties` 的 `server-ip`）。

## 5. 日常更新循环

1. 编辑 `ipthmc.project.json`：增删 `pack.mods`、调整 `pack.versionId`。
2. `mc_resolve` 检查冲突（加载器/版本不匹配、缺失前置）。
3. `mc_pack` 生成新 `.mrpack`（客户端分发/上传 Modrinth）。
4. `mc_pack_install` 同步服务端 `mods/`；`mc_pack_check` 复核哈希。
5. 重启服务端；观察日志 `logs/latest.log`。
6. 客户端：Modrinth App / Prism 导入 `.mrpack`；服务端与客户端必须使用同一 `versionId` 的包。

> 建议每次发版记录：`versionId`、对应 mrpack 的 sha1（`mc_pack` 会输出）、模组版本清单。

## 6. 备份与监控

- 备份：`world/`、`world_nether/`、`world_the_end/`、`config/`、`plugins/`、`mods/`、`server.properties`；推荐每日增量 + 异地。
- 状态巡检：`mc_status host=<地址> [port=]`，支持 `_minecraft._tcp` SRV 解析；返回版本/玩家/MOTD/延迟/favicon。
- 官网/QQ 群状态展示：把 `mc_status` 结果接到定时任务或面板（下一阶段插件会提供 Web UI 看板）。

## 7. 常见问题

| 现象 | 排查 |
|---|---|
| 客户端连代理报 "Unable to connect" | 代理未启动 / 端口未放行 / `try` 里的后端不可达 |
| 进服掉线，日志 `player_info_forwarding` 相关 | 三处转发配置不一致（见 §4） |
| `mc_pack_check` 报哈希不匹配 | 手工替换过 jar / 服务端装了另一版本；重新 `mc_pack_install --overwrite` |
| NeoForge 启动报 `unix_args.txt` 不存在 | 未运行 installer `--installServer` |
| 中文 MOTD 乱码 | 直接在 `server.properties` 写中文可能因编码异常；用插件重新生成（自动 `\u` 转义） |
