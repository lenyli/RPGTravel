#!/bin/zsh -l
set -eu
cd -- "${0:A:h}"

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  print '旅章需要 Node.js 22.12 或更新版本，请安装后重新打开。'
  read -r '?按回车关闭。'
  exit 1
fi

if [[ ! -d node_modules/vite ]]; then
  print '请先在本目录执行 npm ci 安装依赖，再重新打开。'
  read -r '?按回车关闭。'
  exit 1
fi

if /usr/bin/curl -fsS --max-time 2 http://127.0.0.1:4173/ 2>/dev/null | /usr/bin/grep -q 'name="rpg-build"'; then
  /usr/bin/open http://127.0.0.1:4173/
  exit 0
fi

print '正在准备旅章。启动后请保留此终端窗口；按 Control-C 可以停止。'
DEPLOY_BASE=/ BUILD_OUT_DIR=dist npm run build
npm run preview -- --port 4173 --strictPort --open
