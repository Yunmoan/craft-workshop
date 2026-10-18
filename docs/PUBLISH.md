# 推送到 GitHub（public）

目标仓库：**`Yunmoan/craft-workshop`**（公开）。
本地已经 `git init` 并提交（分支 `main`），remote 已指向 `git@github.com:Yunmoan/craft-workshop.git`。

## 需要你做的登录/授权步骤（当前尚未推送）

### 方式 A：SSH 部署密钥（推荐，本仓库已生成）

1. 浏览器登录 GitHub（账号 `Yunmoan`）。
2. 新建公开仓库：<https://github.com/new> → 名称 `craft-workshop` → **Public** → **不要**勾选 README / .gitignore / license（保持空仓库）。
3. 打开 <https://github.com/settings/keys> → **New SSH key** → Title 填 `IPTHMC CraftWorkshop`，Key 粘贴：

   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAxmbQDPtzBzhFtckjuAlw5YjWuH6iKmUbePUMofQPWP ipthmc@craftworkshop
   ```

4. 回到工作区执行：

   ```bash
   ./scripts/push-github.sh
   ```

   成功后会输出 `main -> main`，之后可以用 `git push` 直接推。

> 私钥在 `.gitkeys/ipthmc_deploy`，已被 `.gitignore` 排除，不会进仓库。
> 如果希望改用 HTTPS + Personal Access Token：`git remote set-url origin https://github.com/Yunmoan/craft-workshop.git`，然后按 GitHub 提示登录。

### 方式 B：让 Agent 代为推送（需要 PAT）

1. 生成 classic PAT（勾选 `public_repo` 即可）：<https://github.com/settings/tokens>。
2. 保存到 `/Users/liminghan/ipthmc/.gitkeys/github_token`（一行纯 token）。
3. 告诉 Agent「已写入 token」，Agent 会用 GitHub API 建仓并推送，完成后删除 token 文件。

## 仓库里有什么 / 没有什么

**包含**：`craft-workshop/`（Host 插件）、`craft-workshop-ui/`（Web UI）、`project.json`、`design/`（模板）、`docs/`（创作手册、部署手册、调研资料）、`README.md`、推送脚本。

**排除（`.gitignore`）**：
- `server/`、`proxy/`：服务端/代理运行目录，含 `eula.txt`、**`forwarding.secret`** 等本机凭据；
- `builds/`、`build/`：可随时用工具重建的产物；
- `.gitkeys/`：SSH 私钥；
- `node_modules/`、`.DS_Store`、日志。

## 提交身份

当前本地提交作者为 `IPTHMC <ipthmc@users.noreply.github.com>`（占位）。如需改成你的 GitHub 身份：

```bash
git config user.name  "你的名字"
git config user.email "你的邮箱"
git commit --amend --reset-author --no-edit
```

## 可选后续

- 添加 LICENSE（目前未添加，公开仓库默认保留所有权利）。如要开源建议 MIT/Apache-2.0。
- 发布插件时可以把 `craft-workshop/` 单独拆成 npm/GitHub 仓库；当前先作为单仓库维护。
