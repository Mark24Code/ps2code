#!/usr/bin/env bash
#
# unquarantine.sh — 去除 PS2Code.app 的 macOS 隔离属性
#
# 用途:PS2Code 使用本地 ad-hoc 签名(未经 Apple 公证),
# 从别的 Mac 拷入或下载后,Gatekeeper 会因 quarantine 属性拦截打开。
# 运行本脚本去掉该属性即可正常打开。
#
# 用法:
#   ./unquarantine.sh                      # 自动找同目录/Applications 下的 PS2Code.app
#   ./unquarantine.sh /path/to/PS2Code.app # 指定路径

set -euo pipefail

APP="${1:-}"

if [[ -z "$APP" ]]; then
  if [[ -d "./PS2Code.app" ]]; then
    APP="./PS2Code.app"
  elif [[ -d "/Applications/PS2Code.app" ]]; then
    APP="/Applications/PS2Code.app"
  else
    echo "未找到 PS2Code.app,请把路径作为参数传入:" >&2
    echo "  ./unquarantine.sh /Applications/PS2Code.app" >&2
    exit 1
  fi
fi

if [[ ! -d "$APP" ]]; then
  echo "路径不存在或不是 .app:$APP" >&2
  exit 1
fi

echo "去除隔离属性:$APP"
xattr -dr com.apple.quarantine "$APP"
echo "完成。现在可以直接打开 PS2Code。"
