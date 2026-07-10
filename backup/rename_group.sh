#!/usr/bin/env bash
#
# rename_group.sh — 调用 Photoshop 对指定设计稿的图层组批量改名
#
# 用法:
#   ./rename_group.sh <设计稿> <旧组名>=<新组名> [<旧组名>=<新组名> ...]
#
# 示例:
#   ./rename_group.sh a签到.psd "组 93=组 193"
#   ./rename_group.sh /abs/path/a签到.psd "组 93=组 193" "组 5=组 105"
#
# 说明:
#   - <设计稿> 可为绝对路径，或相对当前目录 / 脚本所在目录的文件名。
#   - 会递归查找所有嵌套图层组；若同名组存在多个，全部改名。
#   - 文件未在 PS 中打开时会自动打开；改完后自动保存回原文件。
#   - 依赖: macOS + Adobe Photoshop。

set -euo pipefail

# ---------- 参数校验 ----------
if [[ $# -lt 2 ]]; then
  echo "用法: $0 <设计稿> <旧组名>=<新组名> [<旧组名>=<新组名> ...]" >&2
  echo "示例: $0 a签到.psd \"组 93=组 193\"" >&2
  exit 1
fi

DESIGN_INPUT="$1"; shift

# ---------- 解析 PS 应用名（兼容不同版本） ----------
PS_APP="$(osascript -e 'tell application "System Events" to get name of (first process whose name contains "Photoshop")' 2>/dev/null || true)"
if [[ -z "$PS_APP" ]]; then
  # 进程未运行则从已安装应用里找一个
  PS_APP="$(ls -d /Applications/Adobe\ Photoshop* 2>/dev/null | head -n1 | xargs -I{} basename {} .app || true)"
fi
if [[ -z "$PS_APP" ]]; then
  echo "未找到 Adobe Photoshop，请确认已安装。" >&2
  exit 1
fi

# ---------- 解析设计稿绝对路径 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
resolve_path() {
  local p="$1"
  if [[ "$p" = /* && -f "$p" ]]; then echo "$p"; return; fi
  if [[ -f "$PWD/$p" ]]; then echo "$PWD/$p"; return; fi
  if [[ -f "$SCRIPT_DIR/$p" ]]; then echo "$SCRIPT_DIR/$p"; return; fi
  echo ""; # 未找到
}
DESIGN_PATH="$(resolve_path "$DESIGN_INPUT")"
if [[ -z "$DESIGN_PATH" ]]; then
  echo "找不到设计稿文件: $DESIGN_INPUT" >&2
  exit 1
fi

# ---------- 构造改名规则的 JS 数组 ----------
# 每条规则形如  旧=新 ，转成 {from:"旧",to:"新"}
js_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
RULES_JS=""
for pair in "$@"; do
  if [[ "$pair" != *"="* ]]; then
    echo "规则格式错误(应为 旧组名=新组名): $pair" >&2
    exit 1
  fi
  from="${pair%%=*}"
  to="${pair#*=}"
  # 去掉首尾空格
  from="$(echo "$from" | sed 's/^ *//; s/ *$//')"
  to="$(echo "$to" | sed 's/^ *//; s/ *$//')"
  RULES_JS+="{from:\"$(js_escape "$from")\",to:\"$(js_escape "$to")\"},"
done

# ---------- 生成 JSX ----------
JSX_FILE="$(mktemp /tmp/ps_rename_XXXXXX.jsx)"
trap 'rm -f "$JSX_FILE"' EXIT

cat > "$JSX_FILE" <<JSX
#target photoshop
(function () {
  var rules = [${RULES_JS}];
  var targetPath = "${DESIGN_PATH}";

  // 若目标文件未打开则打开它；否则复用已打开的文档
  var doc = null;
  for (var d = 0; d < app.documents.length; d++) {
    try { if (app.documents[d].fullName.fsName === new File(targetPath).fsName) { doc = app.documents[d]; break; } } catch (e) {}
  }
  if (doc === null) {
    var f = new File(targetPath);
    if (!f.exists) { return "FILE NOT FOUND: " + targetPath; }
    doc = app.open(f);
  }
  app.activeDocument = doc;

  // 递归改名: 遍历所有层级的 layerSets
  function renameIn(container, rule, log) {
    for (var i = 0; i < container.layerSets.length; i++) {
      var g = container.layerSets[i];
      if (g.name === rule.from) {
        g.name = rule.to;
        log.count++;
        log.paths.push(rule.to);
      }
      renameIn(g, rule, log); // 递归进入子组（注意：子组名此时可能已改）
    }
  }

  var report = [];
  for (var r = 0; r < rules.length; r++) {
    var log = { count: 0, paths: [] };
    renameIn(doc, rules[r], log);
    if (log.count > 0) {
      report.push("OK  " + rules[r].from + " -> " + rules[r].to + "  (改了 " + log.count + " 处)");
    } else {
      report.push("SKIP  未找到组: " + rules[r].from);
    }
  }

  // 保存回原文件
  doc.save();
  report.push("SAVED  " + doc.name);
  return report.join("\n");
})();
JSX

# ---------- 调用 Photoshop 执行 ----------
echo "设计稿 : $DESIGN_PATH"
echo "PS 应用: $PS_APP"
echo "改名规则:"
for pair in "$@"; do echo "  - $pair"; done
echo "----------------------------------------"

RESULT="$(osascript -e "tell application \"$PS_APP\"
  activate
  do javascript (read POSIX file \"$JSX_FILE\" as «class utf8»)
end tell" 2>&1)"

echo "$RESULT"
