#!/usr/bin/env bash
# Push this repository to the configured GitHub remote using the local deploy key.
# Prerequisite: the public key in .gitkeys/ipthmc_deploy.pub was added to GitHub
# (Settings -> SSH and GPG keys), and the public repository exists.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .gitkeys/ipthmc_deploy ]; then
  echo "缺少 SSH 私钥 .gitkeys/ipthmc_deploy；请重新生成或改用 PAT。"
  exit 1
fi

REMOTE=$(git remote get-url origin 2>/dev/null || echo 'git@github.com:Yunmoan/craft-workshop.git')
echo "推送到 $REMOTE ..."
GIT_SSH_COMMAND="ssh -i .gitkeys/ipthmc_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
  git push -u origin main
