#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'KraftReel CLI 需要 Node.js 18+ 和 npm，请先安装 Node.js：https://nodejs.org/' >&2
  exit 1
fi

npm install --global kraftreel-cli
printf '%s\n' 'KraftReel CLI 安装完成。首次使用请运行：kraftreel login web'
