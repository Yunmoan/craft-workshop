# Minecraft 外部 API 精确事实（curl 实测）

> 实测时间：2026-10-18（Asia/Shanghai），curl 8.7.1。标记：✅=本次真实 curl 验证；📄=官方文档写明；❌=不可用/已下线；⚠️=未能实地验证。
> 统一请求头（Modrinth/Paper 要求）：`User-Agent: dsh-ipthmc-research/0.1 (contact@ipthmc.local)`。本文所有字段名/取值均取自真实响应，未验证项单独标注。

## 0. 总览

| 服务 | Base URL | 认证 | 按 MC 版本+加载器筛选 | 状态 |
|---|---|---|---|---|
| Modrinth | `https://api.modrinth.com/v2` | 无需 token；UA 必填 | facets（loader=category）+ `/project/{id}/version?loaders&game_versions` | ✅ |
| Fabric Meta | `https://meta.fabricmc.net` | 无 | `/v2/versions/loader/{game}` | ✅ |
| Quilt Meta | `https://meta.quiltmc.org/v3` | 无 | `/v3/versions/loader/{game}` | ✅ |
| NeoForge | `https://maven.neoforged.net/releases` | 无 | maven-metadata 版本前缀映射 | ✅ |
| Forge | `https://maven.minecraftforge.net` | 无 | `promotions_slim.json` 键 `<mc>-latest/-recommended` | ✅ |
| Paper/Velocity/Folia | `https://fill.papermc.io/v3` | 无（📄UA 必填） | `/projects/{p}/versions/{v}/builds` | ✅（旧 api.papermc.io/v2 ❌410） |
| Purpur | `https://api.purpurmc.org/v2` | 无 | `/v2/purpur/{version}` | ✅ |
| CurseForge | `https://api.curseforge.com` | **必须** `x-api-key` | 需 key，本环境无 key | ❌无 key 全 403 |
| Java SLP | TCP 任意 MC 服务器:25565 | 无 | 协议层查询 | ✅ |

## 1. Modrinth API v2

### 1.1 端点（✅ 全部实测 200）

| 端点 | 说明 / 参数 |
|---|---|
| `GET /search` | `query`、`facets`（JSON 字符串，需 URL encode）、`index=relevance\|downloads\|follows\|newest\|updated`、`offset`、`limit`（默认 10，>100 时实测被截为 100） |
| `GET /project/{id\|slug}` | slug 与 base62 ID 均可，如 `sodium` / `AANobbMI` |
| `GET /project/{id\|slug}/version` | `loaders`、`game_versions`：**JSON 数组字符串**，如 `?loaders=["fabric"]&game_versions=["1.21.1"]` |
| `GET /version/{version_id}` | 返回 version 对象（数组元素的完整版） |
| `POST /version_files` | body `{"hashes":["..."],"algorithm":"sha512"}` → 返回 `{ "<hash>": version }` |
| `POST /version_files/update` | 同上 body + `loaders`/`game_versions` 字段（数组），返回 `{ "<hash>": 匹配的最新 version }` |
| `GET /version_file/{hash}?algorithm=sha512` | 按文件哈希反查 version |
| `GET /projects?ids=["AANobbMI","YL57xq9U"]` | 批量取 project（数组需 encode） |
| `GET /project/{id}/dependencies` | 返回 `{"projects":[...],"versions":[...]}` |
| `GET /tag/game_version`、`/tag/loader` | 可用的游戏版本/加载器标签（用于校验过滤值） |

### 1.2 facets 语法（📄 docs.modrinth.com，✅ 过滤生效）

- 结构：`[ [...OR组...], [...OR组...] ]`；**内层数组内是 OR，外层数组之间是 AND**。
- 单条 facet 格式 `{type}{op}{value}`，operation 可用 `:`（同 `=`）、`!=`、`>=`、`>`、`<=`、`<`（数值类 type 如 `downloads`、`follows` 可用大小比较）。
- **加载器不是独立 facet type，而是 category**：`categories:fabric`、`categories:quilt`、`categories:neoforge`、`categories:forge`；游戏版本用 `versions:1.21.1`；项目类型 `project_type:mod|modpack|resourcepack|shader`。其他常用：`environment`、`open_source`、`license`、`client_side`（已弃用）、`downloads`、`author`、`project_id`。
- 示例（✅ `total_hits=38`，limit=2 返回 sodium/iris 类结果）：

```bash
curl -sH "User-Agent: dsh-ipthmc-research/0.1 (contact@ipthmc.local)" \
 'https://api.modrinth.com/v2/search?query=sodium&limit=2&facets=%5B%5B%22categories%3Afabric%22%5D%2C%5B%22versions%3A1.20.1%22%5D%2C%5B%22project_type%3Amod%22%5D%5D'
# 数值 facet 实测：downloads>1000000 + project_type:mod → total_hits=2050
```

### 1.3 响应关键字段（真实 keys）

- `/search` 顶层：`hits`、`offset`、`limit`、`total_hits`（无 facets 回显）。
- `hits[i]`：`project_id`、`project_type`、`all_project_types`、`slug`、`title`、`description`、`categories`、`display_categories`、`versions`（支持的游戏版本数组）、`author`、`downloads`、`follows`、`date_created`、`date_modified`、`latest_version`、`license`、`environment`、`client_side`、`server_side`、`icon_url`、`gallery` 等。**注意 hits 里没有 `loaders` 字段**（loader 混在 `categories` 里）。
- project 对象（`/project/{id}`）：`id`、`slug`、`title`、`project_type`、`loaders`、`game_versions`、`environment`、`downloads`、`followers`、`license`、`versions`（version id 数组）、`published`、`updated`、`status`、`requested_status` 等。
- version 对象：`id`、`project_id`、`name`、`version_number`、`version_type`（`release|beta|alpha`）、`game_versions[]`、`loaders[]`、`environment`（`client_only|client_and_server|server_only|...`）、`date_published`、`changelog`、`changelog_url`、`files[]`、`dependencies[]`、`downloads`、`featured`、`status`（实测 `listed`）、`requested_status`。
- `files[]`：`filename`、`url`（CDN 直链，无鉴权）、`size`、`primary`（boolean，**一个 version 通常仅一个 true**）、`file_type`（可能为 `null`）、`hashes{sha1, sha512}`（✅ 全部实测文件只含这两个算法；**算法名就是 `sha1`/`sha512` 键名**）。
- `dependencies[]`：`version_id`（可 null）、`project_id`、`file_name`（可 null，外部依赖时使用）、`dependency_type` ∈ `required|optional|incompatible|embedded`（`required` 实测；其余为 📄 枚举）；`version_id` 为 null 时用 `project_id` 再调 `/project/{id}/version` 解析。
- 真样例（`GET /project/sodium/version?loaders=["fabric"]&game_versions=["1.20.1"]` → 13 条，取 [0] 截断）：

```json
{"id":"OihdIimA","project_id":"AANobbMI","version_number":"mc1.20.1-0.5.13-fabric","version_type":"release",
 "game_versions":["1.20.1"],"loaders":["fabric","quilt"],
 "files":[{"filename":"sodium-fabric-0.5.13+mc1.20.1.jar","primary":true,"size":971552,
   "url":"https://cdn.modrinth.com/data/AANobbMI/versions/OihdIimA/sodium-fabric-0.5.13%2Bmc1.20.1.jar",
   "hashes":{"sha512":"81c64f9c...","sha1":"bcdbf37d..."},"file_type":null}],
 "dependencies":[]}
# iris 的依赖样例：{"version_id":"s7adptIg","project_id":"AANobbMI","file_name":null,"dependency_type":"required"}
```

### 1.4 认证 / 限流 / 坑

- 无需 token；📄 必须发送可识别 UA（不要 `okhttp/x`、`curl/x`）。实测不带头也返回 200，但会被 Cloudflare/风控，务必带。
- 限流 300 次/分钟/IP，响应头 `x-ratelimit-limit` / `x-ratelimit-remaining` / `x-ratelimit-reset`（✅ 实测 `limit:300`）。
- 404 返回 **空 body（content-length: 0）**，无 JSON 错误信息；需按状态码判断。
- 数值 facet 写 `downloads>1000000` 时 URL encode 后为 `downloads%3E1000000`；大数组参数必须 encode，否则返回 200 但过滤被忽略。
- 语义：`loaders=["fabric"]` 是「该版本声明支持 fabric」（OR 组内多个值为 OR），`game_versions` 同理；两个参数之间 AND。Modrinth 的 `quilt` 版本常同时标 fabric+quilt。

## 2. Fabric Meta（✅ 全端点实测）

| 端点 | 返回 |
|---|---|
| `GET /v2/versions/game` | `[{"version":"26.4-snapshot-4","stable":false},...]`；**顺序含 snapshot，`?stable=true` 实测无效（仍返回 snapshot）**，须客户端过滤 `stable` |
| `GET /v2/versions/loader` | `[{"separator":".","build":0,"maven":"net.fabricmc:fabric-loader:0.20.0","version":"0.20.0","stable":false},...]` |
| `GET /v2/versions/loader/{game_version}` | 每项 `{loader:{...},intermediary:{...},launcherMeta:{version,min_java_version,libraries,mainClass}}`（✅ 1.21.1 → 首项 loader 0.20.0） |
| `GET /v2/versions/loader/{game}/{loader}/profile/json` | 启动器 profile：`id`（`fabric-loader-{loader}-{game}`）、`inheritsFrom`（=game）、`releaseTime`、`type`、`mainClass`（KnotClient）、`arguments{game,jvm}`、`libraries[]` |
| `GET /v2/versions/loader/{game}/{loader}/server/json` | 服务端 profile，`mainClass=net.fabricmc.loader.impl.launch.knot.KnotServer`（✅ 1.21.1/0.19.5） |
| `GET /v2/versions/installer` | `[{"url":"https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.1.2/fabric-installer-1.1.2.jar","maven":"...","version":"1.1.2","stable":true}]` |
| `GET /v2/versions/intermediary/{game}`、`/v2/versions/yarn/{game}` | 映射版本（✅ 200） |

语义：先取 `loader/{game}` 列表（已按兼容性过滤；首项可能非 stable，选 `loader.stable===true` 的最新），再取 profile json；服务端整合包用 `server/json`。

## 3. Quilt Meta（base `https://meta.quiltmc.org/v3`，✅）

- 端点与 Fabric 对应：`/versions/game`（`{version,stable}`）、`/versions/loader`、`/versions/loader/{game}`、`/versions/loader/{game}/{loader}/profile/json`、`.../server/json`、`/versions/installer`。
- 字段差异：`versions/loader` 项为 `{maven,version,build,separator,file_size,hashes{sha1,sha256,sha512}}`；`loader/{game}` 项为 `{loader,hashed,intermediary,launcherMeta}`（比 Fabric 多 `hashed`）；profile 含 `id/inheritsFrom/type/mainClass/arguments/libraries`；server json 额外 `launcherMainClass`（`org.quiltmc.loader.impl.launch.server.QuiltServerLauncher`）。
- installer：`{"maven":"org.quiltmc:quilt-installer:0.15.1","version":"0.15.1","url":"https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/0.15.1/quilt-installer-0.15.1.jar","file_size":...,"hashes":{...}}`。
- 坑：`/versions/loader/1.21.1` 首项为 `0.20.0-beta.9`（较旧），而全量 loader 最新为 `0.31.0-beta.4`——**必须用按 game 过滤的端点**，不能自己从全量列表推断。

## 4. NeoForge

- 元数据：`https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml`（✅ `<groupId>net.neoforged</groupId><artifactId>neoforge</artifactId><versioning><latest>21.1.263</latest><release>21.1.263</release><versions>...`，共 1842 个版本）。
- 结构化 JSON（Nexus REST，✅）：`GET https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge` → `{"isSnapshot":false,"versions":["20.2.3-beta",...,"26.3.0.92"]}`（顺序按字典序，非版本序）。
- 版本号 ↔ MC 映射（📄 docs.neoforged.net/docs/1.21.1/gettingstarted/versioning/ + ✅ 实测）：
  - MC 1.x：`{minecraft.minor}.{minecraft.patch}.{neoforge build}`，**省略开头的 1**。例：`20.2.93`=1.20.2，`20.4.253`=1.20.4，`20.6.144`=1.20.6，`21.0.167`=1.21，`21.1.263`=1.21.1，`21.11.48`=1.21.11。
  - MC 26.x 新格式（✅ 从 metadata 归纳）：`{major}.{minor}.{patch}.{build}`，例：`26.1.2.122`=MC 26.1.2，`26.2.0.93`=MC 26.2，`26.3.0.92`=MC 26.3；同 MC 线还含 `-alpha`/`-beta`/`+snapshot-N` 后缀，需过滤。
  - MC 1.20.1 是旧 artifact：`net/neoforged/forge/maven-metadata.xml`，版本形如 `1.20.1-47.1.106`（✅ latest）。
- installer URL 模板（✅ HEAD 200）：`https://maven.neoforged.net/releases/net/neoforged/neoforge/{ver}/neoforge-{ver}-installer.jar`（例 `.../21.1.263/neoforge-21.1.263-installer.jar`、`.../26.3.0.92/...`）；1.20.1：`https://maven.neoforged.net/releases/net/neoforged/forge/1.20.1-47.1.106/forge-1.20.1-47.1.106-installer.jar`。
- 坑：maven-metadata 的 `<latest>/<release>` 是**字典序最大**（当前 `21.1.263`），不是最新 MC（26.3 的新版本存在但 latest 不指向它）→ 必须解析 `<versions>` 按 MC 前缀过滤后自行取最大 build。
- 服务端安装：`java -jar neoforge-{ver}-installer.jar --installServer`。

## 5. Forge

- `GET https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json`（✅）：`{"homepage":"...","promos":{"1.21.1-latest":"52.1.20","1.21.1-recommended":"52.1.0","26.3-latest":"66.0.13",...}}`。键为 `<mcver>-latest|-recommended`；**有些线只有 latest 没有 recommended**（如 26.3），取不到时回退 latest。
- 全量版本：`GET https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`（✅ 5093 个，`<latest>26.3-66.0.13</latest>`）；版本字符串为 `<mcver>-<forgever>`（如 `1.21.1-52.1.0`）。
- installer URL 模板（✅ HEAD 200）：`https://maven.minecraftforge.net/net/minecraftforge/forge/{mc}-{forge}/forge-{mc}-{forge}-installer.jar`（例 `.../26.3-66.0.13/forge-26.3-66.0.13-installer.jar`）；同目录还有 `-universal.jar`、`-userdev.jar`（✅）。
- 注意：`https://files.minecraftforge.net/maven/...` 是 301 → `maven.minecraftforge.net`（✅）；`files.minecraftforge.net/.../promotions.json`（非 slim）已 404 ❌。
- 服务端安装：`java -jar forge-{mc}-{forge}-installer.jar --installServer`。

## 6. PaperMC（fill v3）/ Purpur

- ❌ 旧版 `https://api.papermc.io/v2/...` 已下线：任意路径返回 **HTTP 410** `{"ok":false,"error":"sunset","message":"This API version has been sunset and is no longer available. To continue using the service, please upgrade to a supported API version."}`。
- 新版 base `https://fill.papermc.io/v3`（✅ 全部实测 200；`/swagger-ui/index.html` 可交互；另支持 GraphQL `POST /graphql`，✅ 实测返回 `{"data":{"project":{"key":"paper","versions":{"edges":[{"node":{"key":"26.3"}}]}}}}`）：

| 端点 | 返回（真实字段） |
|---|---|
| `GET /projects` | `{"projects":[{"project":{"id":"paper","name":"Paper"},"versions":{"26.3":["26.3","26.3-rc-3"],"1.21":["1.21.11",...]}},...]}` |
| `GET /projects/{project}` | `{"project":{...},"versions":{ "<minor line>": ["26.3",...] }}`（版本按大版本分组，值数组新→旧） |
| `GET /projects/{project}/versions` | `{"versions":[{"version":{"id":"26.3","support":{"status":"SUPPORTED"},"java":{"version":{"minimum":25},"flags":{"recommended":[...]}}},"builds":[3,4,...]},...]}` |
| `GET /projects/{project}/versions/{v}` | `{"version":{"id","support","java"},"builds":[133,132,...]}`（顶层 `builds` 是该版本全部 build id 数组；✅ 1.21.1→128 个） |
| `GET /projects/{project}/versions/{v}/builds` | **顶层是数组**（新→旧）：`[{"id":133,"time":"2025-03-28T16:16:41.212Z","channel":"STABLE","commits":[{"sha","time","message"}],"downloads":{"server:default":{"name":"paper-1.21.1-133.jar","checksums":{"sha256":"..."},"size":49394394,"url":"https://fill-data.papermc.io/v1/objects/{sha256}/paper-1.21.1-133.jar"}}},...]` |
| `GET .../builds/latest` | 单 build 对象（同上结构） |

- 关键语义：下载用 `build.downloads["server:default"].url`（无需拼接、无需再请求）；校验用 `checksums.sha256`；筛选稳定版用 `channel === "STABLE"`（Purpur/Paper 实测；Velocity 最新 build channel 为 `RECOMMENDED`，📄示例只筛 STABLE）；`support.status` 取 `SUPPORTED|UNSUPPORTED`（含 `end` 日期）；`version.java.version.minimum` 给出所需 Java 主版本（26.3→25，1.21.1→21）。
- 📄 Paper 文档（docs.papermc.io/misc/downloads-service/）要求所有请求带非通用 UA 且含联系方式；实测**空 UA 仍 200**，但请遵守。未观察到限流响应头。
- Velocity/Folia 同结构：`/projects/velocity`、`/projects/folia`（✅ 200，velocity 版本组如 `{"4.0.0":[...],"3.0.0":[...]}`）。
- Purpur（✅，无认证）：`GET https://api.purpurmc.org/v2/purpur` → `{"project":"purpur","metadata":{"current":"26.3"},"versions":[...]}`；`GET /v2/purpur/{version}` → `{"project":"purpur","version":"1.21.1","builds":{"latest":"2329","all":["2285",...,"2329"]}}`；`GET /v2/purpur/{version}/{build}` → build 详情（`result:"SUCCESS"`、`commits[]`、`md5` 等）；下载 `GET /v2/purpur/{version}/latest/download`（✅ 200，`content-disposition: attachment; filename="purpur-1.21.1-2329.jar"`）。

## 7. Java 版 Server List Ping（SLP，✅ 用 Node 实测）

协议参考：<https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping>。TCP 直连 25565，**无压缩**；包格式 = `VarInt 包长` + `VarInt packetId` + payload；字符串 = `VarInt 字节长` + UTF-8；VarInt 最多 5 字节。

1. Handshake（client→server，packet id `0x00`）：`protocol_version VarInt` + `server_address String` + `server_port Unsigned Short` + `next_state VarInt=1`（status）。
2. Status Request（client→server，`0x00`）：payload 为空。
3. Status Response（server→client，`0x00`）：payload 是一个 JSON String（✅ 实测 sample 见下）。
4. Ping（client→server，`0x01`）：8 字节 long（任意值）；Pong（server→client，`0x01`）：回显同一 long。用于测延迟。
5. 约定：不确定版本时 protocol_version 用 `-1`；但 Velocity 等代理可能**回显**你发的值（✅ 发 767 得 `protocol:767`，发 -1 得 `protocol:-1`），所以 `version.name` 才是权威展示串。

真响应（✅ `mc.minehut.com:25565`，截断）：

```json
{"version":{"protocol":767,"name":"Velocity 1.7.2-26.3"},
 "players":{"online":5775,"max":1789,"sample":[]},
 "description":{"extra":[{"bold":true,"color":"#84AFFF","text":"      MINEHUT"}," » ",...]},
 "favicon":"data:image/png;base64,iVBORw0K..."}
```

- JSON 字段：`version{name,protocol}`（`name` 必需）、`players{online,max,sample[{name,id}]}`、`description`（**字符串或 text component 对象**，实测两种均出现，例如 Hypixel 返回字符串）、`favicon`（`data:image/png;base64,` 前缀）、可选 `enforcesSecureChat`、`previewsChat`。`players.sample` 可为空数组。
- 实现要点：先读 1 字节再按 VarInt 续读（不要假设一次 read 就是整包）；对无响应服务器设 3~8s 超时；服务器可在握手后直接断连（视为离线）；MOTD 里的 `§x` 是颜色代码，非 JSON 转义。

## 8. CurseForge（明确结论：无 key 不可用）

- Base：`https://api.curseforge.com`；所有 `/v1/*` 都要请求头 `x-api-key: <key>`。✅ 实测无 key / 假 key 访问 `/v1/mods/search?gameId=432&classId=6&pageSize=1` 均 **HTTP 403**，body 为纯文本 `Forbidden: API Key missing or invalid`；`/v1/games` 同样 403。
- Key 需向 Overwolf/CurseForge 申请（📄 support.curseforge.com：提交表单、审核后发唯一 key；T&C 规定 key 不可转让/共享，超配额需另签协议；console.curseforge.com 可管理）。**因此 `/v1/mods/search` 的参数（如 `gameId`、`classId`、`modLoaderType`、`gameVersion`、`index`、`pageSize`）本环境无法实地验证，不写入本文件作为事实**（⚠️ 待拿到 key 后补测）。
- ✅ 无需 key 可用的下载跳转：`GET https://www.curseforge.com/api/v1/mods/{modId}/files/{fileId}/download` → **307**，`Location: https://edge.forgecdn.net/files/{a}/{b}/{filename}?api-key=<token>`（token 为 CDN 用，勿写日志）→ 最终 `200`（实测落到 mediafilez.forgecdn.net，content-length 正常）。前提是已知道 `modId`+`fileId`，而查找文件元数据本身需要 key。
- 无 key 替代：第三方只读 API `GET https://api.cfwidget.com/minecraft/mc-mods/{slug}`（✅ 200，非官方、无鉴权）：字段 `id`、`title`、`urls{curseforge,project}`、`download{id,url,display,name,type,version,filesize,versions,downloads,uploaded_at}`、`versions[]`、`files`；仅适合查最新文件，不适合按版本/加载器搜索。另 `api.curserinth.dev`（第三方 CurseForge→Modrinth 代理）实测 SSL 连接失败 ❌。
- 建议：插件 MVP 不做 CurseForge 搜索（无 key 不可行）；如需支持，走 Modrinth 优先 + 允许用户配置 CurseForge key。

## 9. 按「MC 版本 + 加载器」筛选资源的实现语义（可直接照抄）

| 需求 | 做法 |
|---|---|
| Modrinth 搜模组/整合包 | `/search?facets=[["categories:{loader}"],["versions:{mc}"],["project_type:{mod\|modpack}"]]`；再用 `/project/{id}/version?loaders=["{loader}"]&game_versions=["{mc}"]` 取候选 |
| 选定版本文件 | 取 `files[]` 中 `primary===true` 的一项（无 primary 则取第一个）；记录 `hashes.sha512` 用于完整性校验；`url` 直下 |
| 依赖闭包 | 对每个 `dependencies[]` 中 `dependency_type==="required"`：有 `version_id` 直接用，否则用 `project_id` 走版本端点按同 loader/mc 过滤 |
| 加载器版本 | Fabric/Quilt：`/versions/loader/{mc}` 取 `stable:true` 的最新 loader → `profile/json`（客户端）/`server/json`（服务端） |
| 服务端核心 | NeoForge/Forge：按 MC 前缀筛 metadata 取最大 build → installer jar URL；Paper/Velocity/Folia：fill v3 `builds` 筛 `channel` → `downloads["server:default"].url` |
| Java 版本 | Paper fill 的 `version.java.version.minimum`；NeoForge/Forge 按 MC 版本查官方要求（本文未覆盖） |
| 统一请求要求 | 所有 HTTP 客户端带项目 UA（含联系方式）；Modrinth ≤300 req/min；对 404/410/403 分别处理；缓存 metadata（Paper `cache-control: max-age=300`） |

## 10. 不可用 / 未验证清单

- ❌ `api.papermc.io/v2` 全部端点：HTTP 410 sunset，替换为 `fill.papermc.io/v3`（见 §6）。
- ❌ CurseForge 无 key 访问：全 403（见 §8）。
- ❌ `https://files.neoforged.net/api/v1/versions`：404（NeoForge 版本请用 maven-metadata / Nexus REST API）。
- ❌ `https://files.minecraftforge.net/net/minecraftforge/forge/promotions.json`：404（只有 `promotions_slim.json`）。
- ❌ `api.curserinth.dev`：SSL 连接失败。
- ⚠️ CurseForge `/v1/mods/search` 精确参数与限流数值：无 key 无法验证，官方 API 文档站 `docs.curseforge.com` 当前为 JS 单页且无法抓取 API 参考，未写入事实。
- ⚠️ NeoForge 26.x 的 4 段版本号规则（§4）由 maven metadata 实测归纳；官方文档仅覆盖 MC 1.x 规则。
