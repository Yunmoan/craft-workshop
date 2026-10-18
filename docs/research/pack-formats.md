# 整合包格式与服务器配置规范（IPTHMC 插件生成器参考）

> 用途：DSH 插件生成 mrpack / packwiz / CurseForge 清单与服务器配置的字段级依据。
> 基准：MC 26.3 默认文件（2026-10 wiki）、Paper 1.21+/26.x、Velocity 4.0.0、packwiz 0.6.x。`待验证`=未逐字确认；`已弃用`=勿再生成。路径用正斜杠 `/`；大小写敏感（Linux 部署常见坑）。

## 1. Modrinth `.mrpack`
ZIP（MIME `application/x-modrinth-modpack+zip`，扩展名必须 `.mrpack`）内固定结构，三个覆盖目录名必须精确：
`modrinth.index.json`（必须，zip 根，UTF-8）、`overrides/`（可选，两端通用）、`client-overrides/`（可选，仅客户端）、`server-overrides/`（可选，仅服务端）。
层叠：`overrides` →（`server-overrides` 或 `client-overrides`），同路径后者覆盖前者。

`modrinth.index.json` 字段：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `formatVersion` | number | 是 | 必须为 `1` |
| `game` | string | 是 | 仅 `"minecraft"` |
| `versionId` | string | 是 | 本版本唯一标识（任意字符串） |
| `name` | string | 是 | 显示名；`summary`（string，可选）简介 |
| `files` | array | 是 | 见下表，可为空 |
| `dependencies` | object | 是 | 至少含 `minecraft` |

`files[]` 元素：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `path` | string | 是 | 相对实例根；禁止 `..`、盘符 `C:/`、以 `/` 或 `\` 开头 |
| `hashes` | object | 是 | 必须同时含 `sha1` 与 `sha512`（小写 hex） |
| `downloads` | string[] | 是 | 仅 HTTPS；不得含未编码空格；需跟随 ≥3 次 3xx 重定向；上传 Modrinth 仅允许 `cdn.modrinth.com`/`github.com`/`raw.githubusercontent.com`/`gitlab.com` |
| `fileSize` | number | 是 | 字节数 |
| `env` | object | 否 | `client`/`server` 取值 `required`/`optional`/`unsupported`；缺省按双端 required（`待验证`） |

`dependencies` 键：`minecraft`、`forge`、`neoforge`、`fabric-loader`、`quilt-loader`（值不带加载器前缀，如 `"neoforge": "21.1.80"`；可能新增键，需容错）。

```json
{
  "formatVersion": 1, "game": "minecraft", "versionId": "1.0.0", "name": "IPTHMC", "summary": "永世幻想间整合包",
  "files": [{
    "path": "mods/sodium-0.6.13.jar",
    "hashes": { "sha1": "cc29...", "sha512": "d076..." },
    "env": { "client": "required", "server": "unsupported" },
    "downloads": ["https://cdn.modrinth.com/data/AANobbMI/versions/xxx/sodium.jar"],
    "fileSize": 1234567
  }],
  "dependencies": { "minecraft": "1.21.1", "neoforge": "21.1.80" }
}
```

## 2. packwiz
目录：`pack.toml`（入口）+ `index.toml`（索引）+ `mods/*.pw.toml`（每个 mod 一个元文件）+ `config/...`。

`pack.toml` 字段：

| 键 | 必填 | 约束 |
|---|---|---|
| `pack-format` | 是 | 当前 `"packwiz:1.1.0"`；缺省按 `"packwiz:1.0.0"`；必须以 `packwiz:` 开头，后段合法 semver，主版本更高必须拒绝加载 |
| `name` | 是 | 可重复 |
| `index` | 是 | `file`（相对路径，不得越出 pack 根）、`hash-format`（是）、`hash`（否） |
| `versions` | 是 | 键：`minecraft`、`fabric`（注意不是 `fabric-loader`，`待验证`）、`forge`、`neoforge`、`quilt` |
| `author`/`description`/`version` | 否 | 导出 CurseForge/mrpack 时使用 |

```toml
name = "IPTHMC"
pack-format = "packwiz:1.1.0"

[index]
file = "index.toml"
hash-format = "sha256"

[versions]
minecraft = "1.21.1"
neoforge = "21.1.80"
```

`index.toml`：`hash-format` 必填，支持 `sha256`（默认，源码缺省注入）/`sha512`/`sha1`/`md5`/`murmur2`；`[[files]]` 元素：`file`（必填，相对 index）、`hash`（必填）、`hash-format`（可选覆盖）、`metafile = true`（`.pw.toml` 条目必须）。非 metafile 文件由 installer 相对 pack 源 URL 下载。

```toml
hash-format = "sha256"
[[files]]
file = "mods/sodium.pw.toml"
hash = "abcdef..."
metafile = true
```

`mods/*.pw.toml`（字段取自 packwiz 源码 `core/mod.go`）：

| 键 | 必填 | 说明 |
|---|---|---|
| `name` / `filename` | 是 | 显示名 / 安装后的文件名 |
| `side` | 否 | `both`(默认)/`client`/`server` |
| `pin` | 否 | 布尔，锁定不自动更新 |
| `[download]` | 是 | `url`、`hash-format`、`hash`；可选 `mode = "metadata:curseforge"`（仅元数据） |
| `[update.modrinth]` | 否 | `mod-id`、`version` |
| `[update.curseforge]` | 否 | `project-id`、`file-id` |
| `[option]` | 否 | `optional`(bool)、`description`、`default`(bool)，即“可选 mod” |

```toml
name = "Sodium"
filename = "sodium-fabric-0.6.13+mc1.21.1.jar"
side = "client"

[download]
url = "https://cdn.modrinth.com/data/AANobbMI/versions/xxx/sodium.jar"
hash-format = "sha512"
hash = "abc..."
```

installer：客户端把 `packwiz-installer-bootstrap.jar` 放 `.minecraft/`，prelaunch 执行 `java -jar packwiz-installer-bootstrap.jar https://host/pack/pack.toml`；服务端启动脚本先执行 `java -jar packwiz-installer-bootstrap.jar -g -s server <pack.toml URL>`（`-g` 无 GUI，`待验证`）。导出：`packwiz mr export` / `packwiz curseforge export`（`待验证`）。

## 3. CurseForge `manifest.json`
> 无官方 schema 页；依据第三方文档+launcher 行为（`待验证`）。`projectID`/`fileID` 必须为 CurseForge 数字 ID。

| 键 | 必填 | 说明 |
|---|---|---|
| `minecraft.version` | 是 | 如 `"1.21.1"` |
| `minecraft.modLoaders[].id` | 是 | `<loader>-<version>`，loader ∈ `forge`/`neoforge`/`fabric`/`quilt`；`primary` 仅一个 `true` |
| `manifestType` / `manifestVersion` | 是 | 固定 `"minecraftModpack"` / `1` |
| `name` / `version` / `author` / `files[]` | 是 | 字符串三项；`files[]` 元素为 `projectID`(number)、`fileID`(number)、`required`(bool) |
| `overrides` | 是 | 覆盖目录名，通常 `"overrides"`；可选 `modlist.html` |

```json
{
  "minecraft": { "version": "1.21.1", "modLoaders": [{ "id": "neoforge-21.1.80", "primary": true }] },
  "manifestType": "minecraftModpack", "manifestVersion": 1,
  "name": "IPTHMC", "version": "1.0.0", "author": "team",
  "files": [{ "projectID": 238222, "fileID": 5246076, "required": true }],
  "overrides": "overrides"
}
```

## 4. `server.properties`
规则：Java `Properties` 语法（`key=value`、`#` 注释、UTF-8，值均为字符串）；服务端启动会重写文件（补默认、丢注释、`:` 转义为 `\:`，如 `level-type=minecraft\:normal`）；改动需重启。**生成器必须显式写出每个键**（默认值随版本变化）。

| 键 | 默认值 | 合法值/备注 |
|---|---|---|
| `motd` / `server-ip` / `server-port` | `A Minecraft Server` / 空 / `25565` | 空 IP=绑所有网卡（代理后端绑内网）；端口 1–65534 |
| `online-mode` / `enforce-secure-profile` | `true` / `true` | Velocity 后端 `online-mode=false` |
| `max-players` / `view-distance` / `simulation-distance` | `20` / `10` / `10` | 视距 3–32（半径） |
| `difficulty` / `gamemode` / `force-gamemode` / `hardcore` | `easy` / `survival` / `false` / `false` | difficulty ∈ `peaceful`/`easy`/`normal`/`hard` |
| `level-name` / `level-seed` / `level-type` / `generator-settings` | `world` / 空 / `minecraft:normal` / `{}` | `generate-structures`(bool)=`true` |
| `spawn-protection` / `allow-flight` | `16` / `false` | spawn-protection 0=关闭；飞行类 mod 服 allow-flight=true |
| `white-list` / `enforce-whitelist` | `true` / `false` | **26.3 默认 true；1.21.x 及以前为 false（`待验证`），务必显式写** |
| `op-permission-level` / `function-permission-level` | `4` / `2` | 1–4 |
| `player-idle-timeout` / `rate-limit` | `0` / `0` | 0=不踢 / 0=关闭包限速 |
| `network-compression-threshold` | `256` | -1=禁用压缩；0=全压缩 |
| `sync-chunk-writes` / `use-native-transport` | `true` / `true` | 后者仅 Linux 生效 |
| `max-tick-time` / `max-world-size` / `entity-broadcast-range-percentage` | `60000` / `29999984` / `100` | max-tick-time=-1 禁用 watchdog（旧版设 1 亦可）；实体广播 10–1000 |
| `prevent-proxy-connections` / `require-resource-pack` | `false` / `false` | 代理环境前者保持 false；后者 true=拒绝资源包即踢 |
| `resource-pack` / `-sha1` / `-id` / `-prompt` | 空 | sha1 小写 hex；id 为带连字符 UUID；prompt 文本/JSON |
| `enable-status` / `hide-online-players` / `enable-query` / `query.port` | `true` / `false` / `false` / `25565` | query 走 UDP |
| `enable-rcon` / `rcon.port` / `rcon.password` | `false` / `25575` / 空 | 密码空则 rcon 不启动 |
| `enable-jmx-monitoring` / `broadcast-console-to-ops` / `broadcast-rcon-to-ops` | `false` / `true` / `true` | |
| `log-ips` / `pause-when-empty-seconds` / `region-file-compression` | `true` / `60` / `deflate` | pause-when-empty 1.21.2+；压缩 `deflate`/`lz4`/`none` |
| `initial-enabled-packs` / `initial-disabled-packs` | `vanilla` / 空 | |
| `text-filtering-config` / `text-filtering-version` / `max-chained-neighbor-updates` | 空 / `0` / `1000000` | |
| `bug-report-link` / `enable-code-of-conduct` | 空 / `false` | 1.21+ / 1.21.9+ |
| `accepts-transfers` / `status-heartbeat-interval` / `chat-spam-threshold-seconds` / `command-spam-threshold-seconds` | `false` / `0` / `10` / `10` | 新版键（`待验证` 起始版本） |
| `management-server-enabled` / `-host` / `-port` | `false` / `localhost` / `0` | 1.21.9+，一般关闭 |

版本变更（必须按目标版本分支）：`1.21.9`（25w35a）起移除 `allow-nether`（→游戏规则 `allowEnteringNetherUsingPortals`）、`enable-command-block`（→`enableCommandBlocks`）、`pvp`（→`pvp`）、`spawn-monsters`（→`spawnMonsters`）——面向 ≤1.21.8 的目标版本时仍写这三键，旧默认 `pvp=true`、`enable-command-block=false`、`allow-nether=true`；**已弃用** `spawn-animals`、`spawn-npcs`。

## 5. Paper 配置体系
首启生成：`config/paper-global.yml`、`config/paper-world-defaults.yml`、`bukkit.yml`、`spigot.yml`、`commands.yml`、`permissions.yml`、`world/paper-world.yml`（单世界覆盖 defaults）。

`paper-global.yml` 主要分组（`_version` 勿改）：

| 分组 | 关键键=默认值 |
|---|---|
| `anticheat.obfuscation` | `enable-item-obfuscation: false`、`sanitize-count: true` |
| `block-updates` | `disable-chorus-plant-updates: false`、`disable-noteblock-updates: false`、`disable-tripwire-updates: false` |
| `chunk-loading-basic` | `player-max-chunk-generate-rate: -1.0`、`player-max-chunk-load-rate: 100`、`player-max-chunk-send-rate: 75` |
| `chunk-loading-advanced` | `auto-config-send-distance: true`、`player-max-concurrent-chunk-generates: 0`、`player-max-concurrent-chunk-loads: 0` |
| `chunk-system` / `collisions` | `io-threads: -1`、`worker-threads: -1`（-1=自动）/ `enable-player-collisions: true`、`send-full-pos-for-hard-colliding-entities: true` |
| `commands` / `console` | `ride-command-allow-player-as-vehicle: false`、`suggest-player-names-when-null-tab-completions: true` / `enable-brigadier-completions: true` |
| `messages` / `player-auto-save` | 系统/踢出消息（MiniMessage，如 `kick.*`）/ `rate: -1`、`max-per-tick: -1`（`待验证`） |
| `packet-limiter` | `all-packets`/`overrides`/`incoming-packet-threshold`/`max-per-tick`/`kick`（子键 `待验证`） |
| `proxies` | `bungee-cord.online-mode: true`、`proxy-protocol: false`、`velocity.enabled: false`、`velocity.online-mode: true`、`velocity.secret: ''` |
| `scoreboards` / `spark` / `watchdog` / `unsupported-settings` | `save-empty-scoreboard-teams: true`、`track-plugin-scoreboards: false` / `enabled: false` / `early-warning-delay: 10000`、`early-warning-every: 5000`（`待验证`）/ 实验开关默认关闭（具体键 `待验证`） |
| `spam-limiter` | `incoming-packet-threshold: 300`、`recipe-spam-limit: 20`、`tab-spam-limit: 500`（部分 `待验证`） |

`paper-world-defaults.yml` 主要分组：

| 分组 | 关键键=默认值 |
|---|---|
| `anticheat.anti-xray` | `enabled: false`、`engine-mode: 1`、`max-block-height: 64`、`update-radius: 2`、`lava-obscures: false`、`use-permission: false` |
| `chunks` | `auto-save-interval: default`、`delay-chunk-unloads-by: 10s`、`max-auto-save-chunks-per-tick: 24`、`prevent-moving-into-unloaded-chunks: false`、`min-chunk-unload-count: 50`、`min-chunk-unload-fraction: 0.05` |
| `collisions` / `command-blocks` | `max-entity-collisions: 8`、`only-players-collide: false`、`allow-player-cramming-damage: false` / `permissions-level: 2`、`force-follow-perm-level: true` |
| `entities` / `environment` / `fixes` / `hopper` / `lootables` / `maps` / `misc` / `scoreboards` / `spawn` / `tick-rates` | `entities.armor-stands.tick: true`、`behavior`/`spawning` 子组；其余为环境、修复开关、漏斗、战利品、地图物品框、杂项、计分板、出生点、tick 速率（具体子键 `待验证`） |
| `feature-seeds` / `mob-effects` / `unsupported-settings` | 特性种子、生物效果、实验开关 |

其他：`spigot.yml` 分组 `settings`（`bungeecord: false`、`timeout-time: 60`、`restart-on-crash: true`、`netty-threads: 4`、`user-cache-size: 1000`、`moved-wrongly-threshold: 0.0625`、`moved-too-quickly-multiplier: 10.0`）、`messages`、`commands`、`world-settings.default`（`verbose: false`、`mob-spawn-range`、`entity-activation-range`、`entity-tracking-range`、`ticks-per`；数值 `待验证`）。`bukkit.yml` 已核对源码默认：`settings.allow-end: true`、`connection-throttle: 4000`、`spawn-limits{monsters: 70, animals: 10, water-animals: 5, water-ambient: 20, water-underground-creature: 5, axolotls: 5, ambient: 15}`、`chunk-gc.period-in-ticks: 600`、`ticks-per{animal-spawns: 400, monster-spawns: 1, autosave: 6000}`、`aliases: now-in-commands.yml`。`commands.yml`：`command-block-overrides: []`、`ignore-vanilla-permissions: false`。启动参数：`--nogui` 必备。

Aikar JVM flags（官方推荐，`-Xms`=`-Xmx`）：

```
-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch
-XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4
-XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true
```

## 6. 文件布局、数据文件与启动脚本
```
server/
├── eula.txt  server.properties  ops.json  whitelist.json
├── banned-players.json  banned-ips.json  usercache.json
├── bukkit.yml  spigot.yml  commands.yml  permissions.yml
├── config/paper-global.yml  config/paper-world-defaults.yml
├── plugins/  logs/  cache/  libraries/  versions/          # 插件与 Paper 运行时
├── world/（+ world_nether/、world_the_end/；纯 vanilla 用 world/DIM-1、DIM1）
├── mods/  config/  defaultconfigs/                          # Fabric/NeoForge 服务端
└── start.sh | start.bat
```

| 文件 | 结构（服务端稳定生成，可直接写） |
|---|---|
| `eula.txt` | `eula=true`（写入即代表同意 EULA） |
| `ops.json` / `whitelist.json` | `[{"uuid":"...","name":"Steve","level":4,"bypassesPlayerLimit":false}]` / 仅 `uuid`+`name` 两键 |
| `banned-players.json` / `banned-ips.json` | `[{"uuid":"...","name":"Steve","created":"2026-01-01 00:00:00 +0800","source":"Server","expires":"forever","reason":"..."}]` / 同结构但首键为 `"ip"` |

注意：`online-mode=false` 时 UUID 为离线 UUID（`OfflinePlayer:<name>` 的 MD5 v3，`待验证`），不能用 Mojang UUID。

`start.sh`（chmod +x）：

```bash
#!/usr/bin/env bash
cd "$(dirname "$0")"
exec java -Xms4G -Xmx4G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions \
  -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M \
  -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 \
  -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem \
  -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true -jar paper.jar --nogui
```

`start.bat`：

```bat
@echo off
cd /d %~dp0
java -Xms4G -Xmx4G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true -jar paper.jar --nogui
pause
```

Java：MC 1.20.5+/26.x 需 Java 21，更早版本 Java 17（`待验证` 下限）。

## 7. Velocity 代理
`velocity.toml` 关键项（默认值取 Velocity 4.0.0 `default-velocity.toml`）：

| 键 | 默认 | 说明 |
|---|---|---|
| `config-version` | `"2.9"` | 勿修改 |
| `bind` / `motd` | `"0.0.0.0:25565"` / `"<#09add3>A Velocity Server"` | motd 为 MiniMessage |
| `show-max-players` / `online-mode` / `force-key-authentication` | `500` / `true` / `true` | 仅显示用 / 验证账号 / 公钥强制 |
| `player-info-forwarding-mode` | `"NONE"` | `none`/`legacy`/`bungeeguard`/`modern`；1.13+ 用 `modern` |
| `forwarding-secret-file` | `"forwarding.secret"` | 内容与 Paper `proxies.velocity.secret` 一致 |
| `announce-forge` / `kick-existing-players` / `enable-player-address-logging` / `prevent-client-proxy-connections` | `false` / `false` / `true` / `false` | 模组服建议 announce-forge=true |
| `[servers]` + `try` / `[forced-hosts]` / `[ping-passthrough]` | `lobby = "127.0.0.1:30066"`；`try = ["lobby"]` / `"lobby.example.com" = ["lobby"]` / `version/players/description/favicon/modinfo: false` | try=登录/被踢后的尝试顺序；ping 透传模组服可开 `modinfo` |
| `[advanced]` | `compression-threshold: 256`、`compression-level: -1`、`login-ratelimit: 3000`、`connection-timeout: 5000`、`read-timeout: 30000`、`bungee-plugin-message-channel: true`、`failover-on-unexpected-server-disconnect: true`、`announce-proxy-commands: true`、`command-rate-limit: 50`、`tab-complete-rate-limit: 10`、`accepts-transfers: false` | |
| `[query]` / `[packet-limiter]` | `enabled: false`、`port: 25565`、`map: "Velocity"`、`show-plugins: false` / `interval: 7`、`packets-per-second: -1`、`bytes-per-second: -1`、`decompressed-bytes-per-second: 5242880` | |

代理 + Paper 联动（必须同时改三处）：① `velocity.toml`：`player-info-forwarding-mode = "modern"`、`forwarding-secret-file = "forwarding.secret"`；② 后端 `server.properties`：`online-mode=false`、`server-ip` 绑内网；③ 后端 `paper-global.yml`：`proxies.velocity.enabled: true`、`online-mode: true`、`secret` 与 secret 文件相同。

## 8. 客户端-服务端一致性
判断优先级：① Modrinth/CurseForge 项目页 Client/Server 标记 → ② jar 内元数据 → ③ 人工核实。

| 元数据来源 | 字段/取值 |
|---|---|
| Modrinth API project / 生成物 | project 的 `client_side`/`server_side` ∈ `required`/`optional`/`unsupported`；`.mrpack` `files[].env`、packwiz `side`、CurseForge `files[].required` |
| Fabric | `fabric.mod.json` → `"environment": "client"` / `"server"` / `"*"` |
| Forge / NeoForge | `META-INF/mods.toml` / `neoforge.mods.toml` → `displayTest`（`MATCH_VERSION`/`IGNORE_SERVER_VERSION`/`IGNORE_ALL_VERSION`/`NONE`） |

| 类别 | 判定 | 常见例子 |
|---|---|---|
| 仅客户端 | 渲染/优化/UI/输入/小地图/着色器 | Sodium、Iris Shaders、OptiFine、Entity Culling、ImmediatelyFast、Xaero's Minimap、JourneyMap、JEI/REI/EMI |
| 仅服务端 | 权限/保护/统计/预生成（插件） | LuckPerms、CoreProtect、WorldGuard、Chunky、Spark、Carpet |
| 建议双端（装了更好） | 优化/前置库 | Lithium、Krypton、FerriteCore、ModernFix、Fabric API、Architectury API |
| 必须双端 | 新增方块/物品/实体/维度/配方/自定义网络包 | Create、Mekanism、AE2、Botania、Farmer's Delight、GeckoLib、Kotlin for Forge |

- 前置库（Fabric API、Architectury API）必须装在真正加载该 mod 的环境；仅客户端 mod 的依赖不要写进服务端。加载器不可混装：Forge（1.20.1 及以前主线）与 NeoForge（1.20.2+）互斥；Quilt 大多兼容 Fabric mod；插件（Bukkit API）只需服务端。
- 服务端推荐组合：性能 `Spark`+`Chunky`；权限 `LuckPerms`；保护 `CoreProtect`+`WorldGuard`；基础 `EssentialsX`+`Vault`+`PlaceholderAPI`；版本兼容 `ViaVersion`+`ViaBackwards`(+`ViaRewind`)；基岩互通 `Geyser`(+`Floodgate`)；反作弊 `GrimAC`。

## 9. 常见插件配置位置与格式
| 插件/模组 | 路径（相对服务端根） | 格式 | 要点 |
|---|---|---|---|
| LuckPerms | `plugins/LuckPerms/config.yml` | YAML | 目录名大写；`storage-method`（默认 `h2`，`待验证`） |
| CoreProtect | `plugins/CoreProtect/config.yml` | YAML | SQLite/MySQL 后端、日志保留 |
| EssentialsX | `plugins/Essentials/config.yml` | YAML | 目录名 `Essentials`（非 EssentialsX） |
| PlaceholderAPI | `plugins/PlaceholderAPI/config.yml`；扩展在 `expansions/` | YAML | `/papi ecloud download` |
| Geyser | `plugins/Geyser-Spigot/config.yml`（或 `Geyser-Standalone/config.yml`） | YAML | `bedrock.address/port`、`remote.address/port`、`auth-type`（`online`/`floodgate`/`offline`） |
| ViaVersion | `plugins/ViaVersion/config.yml` | YAML | 通常零配置；代理端+服务端都装 |
| Paper 自身 | `config/paper-global.yml`、`config/paper-world-defaults.yml`、`world/paper-world.yml` | YAML | 见 §5 |
| Forge/NeoForge mod | `config/<modid>-common.toml`、`-client.toml`、`-server.toml` | TOML | `defaultconfigs/` 可作新实例默认配置（`待验证`） |
| Fabric mod | `config/<modid>.{json,toml,json5}` | 不定 | Fabric 无统一配置 API；Cloth Config 常用 `.json5` |

Vault 无配置文件（纯 API 桥，需另装权限/经济实现）。打包建议：配置放 `overrides/config/...`（mrpack/CurseForge）或 packwiz `config/...` 并由 `index.toml` 引用；服务端专属配置放 `server-overrides/`（mrpack）。

## 10. 来源
- mrpack：<https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack>；packwiz：<https://packwiz.infra.link/reference/pack-format/pack-toml/>、<https://packwiz.infra.link/reference/pack-format/index-toml/>、源码 <https://github.com/packwiz/packwiz>（`core/pack.go`、`core/mod.go`、`core/index.go`）
- CurseForge manifest（第三方说明）：<https://gdlauncher.com/docs/modpack-manifest-format/>；API：<https://docs.curseforge.com/>；server.properties：<https://minecraft.wiki/w/Server.properties>
- Paper 配置：<https://docs.papermc.io/paper/reference/global-configuration/>、<https://docs.papermc.io/paper/reference/world-configuration/>、<https://docs.papermc.io/paper/reference/spigot-configuration/>、<https://docs.papermc.io/paper/reference/bukkit-configuration/>；默认值源码 <https://github.com/PaperMC/Paper>（`paper-server/src/main/resources/configurations/`）
- Aikar flags：<https://docs.papermc.io/paper/aikars-flags/>；Velocity：<https://docs.papermc.io/velocity/configuration/>；默认值 <https://github.com/PaperMC/Velocity/blob/dev/4.0.0/proxy/src/main/resources/default-velocity.toml>
- 插件文档：LuckPerms <https://luckperms.net/wiki/Configuration>；Geyser <https://wiki.geysermc.org/geyser/>；ViaVersion <https://docs.viaversion.com/>；EssentialsX <https://essentialsx.net/wiki/Home.html>；PlaceholderAPI <https://wiki.placeholderapi.com/>；CoreProtect <https://coreprotect.net/>
