# 推送到 GitHub（public）

目标仓库：**`Yunmoan/craft-workshop`** ｜ 本地分支：`main`（已有 4 个提交）
remote 已配置好两条（`git remote -v` 可查）：

- `origin` → `https://github.com/Yunmoan/craft-workshop.git`（**git 原生登录**，推荐）
- `ssh-origin` → `git@github.com:Yunmoan/craft-workshop.git`（备用，需先加 SSH 公钥）

---

## 方式 A：在 git 里直接登录（HTTPS + Token，推荐）

1. 先在浏览器建**空的 public 仓库**（不要勾 README）：<https://github.com/new> → 名称 `craft-workshop`
2. 生成 Token（二选一）：
   - Classic：<https://github.com/settings/tokens> → Generate new token (classic) → 勾 **`public_repo`**
   - Fine-grained：<https://github.com/settings/personal-access-tokens> → 选该仓库 → **Contents: Read and write**
3. 在终端执行：

   ```bash
   cd ~/ipthmc
   git push -u origin main
   ```

   git 会提示：

   ```
   Username for 'https://github.com': Yunmoan
   Password for 'https://Yunmoan@github.com': <粘贴 Token，不是账号密码>
   ```

   成功后 macOS 钥匙串（`credential.helper=osxkeychain`）会记住凭据，之后再 `git push` 不再询问。

> 想提前把凭据写进钥匙串（这样 Agent 也能直接推送）：
>
> ```bash
> printf 'protocol=https\nhost=github.com\nusername=Yunmoan\npassword=<你的TOKEN>\n\n' | git credential-osxkeychain store
> ```

## 方式 B：SSH 部署密钥（无需每次输入）

1. 建空仓库（同上）。
2. 打开 <https://github.com/settings/keys> → New SSH key → Authentication，粘贴：

   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAxmbQDPtzBzhFtckjuAlw5YjWuH6iKmUbePUMofQPWP ipthmc@craftworkshop
   ```

3. 执行：

   ```bash
   cd ~/ipthmc
   ./scripts/push-github.sh        # 使用 .gitkeys/ipthmc_deploy 私钥推送到 ssh-origin
   ```

## 方式 C：让 Agent 代推

把 Token 写入 `.gitkeys/github_token`（一行纯 Token，已被 `.gitignore` 排除），告诉 Agent「token 已写入」即可；Agent 会用它完成 `git push`，随后删除该文件。

---

## 仓库里有什么 / 没有什么

**包含**：`craft-workshop/`（Host 插件）、`craft-workshop-ui/`（Web UI 插件）、`project.json`、`design/`（模板）、`docs/`、`README.md`、推送脚本。

**排除（`.gitignore`）**：`server/`、`proxy/`（含 `forwarding.secret`）、`build/`、`builds/`、`.craft-workshop/`（操作历史）、`.gitkeys/`（SSH 私钥）、`node_modules/`。

## 克隆后如何安装插件

`install_bundle` 的 target 必须是**包目录**，不是仓库根：

```
plugin_manager install_bundle  target=/path/to/craft-workshop
plugin_manager install_bundle  target=/path/to/craft-workshop-ui
```

注意：`craft-workshop-ui` 的 `dsh.client` 声明必须在安装/扫描时就存在（Host 侧包元数据在重启前有缓存），所以 UI 单独成包；若以后合并成一个包，需要重启 Harness 才会被重新扫描。

## 提交身份

当前本地提交作者为 `IPTHMC <ipthmc@users.noreply.github.com>`（占位）。如需改成你的身份：

```bash
git config user.name  "你的名字"
git config user.email "你的邮箱"
git commit --amend --reset-author --no-edit
```

## 可选

- LICENSE：目前未添加（公开仓库默认保留所有权利）；要开源建议 MIT/Apache-2.0。
- 插件发布：可把 `craft-workshop/`、`craft-workshop-ui/` 分别拆成独立仓库或发到 npm。
