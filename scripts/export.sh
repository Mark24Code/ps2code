#!/usr/bin/env bash
# ============================================================================
# export.sh — Shell 驱动的 PSD 图层组导出工具
#
# 用法:
#   ./scripts/export.sh --psd /path/to/file.psd --names "组84,组85" \
#                       --output /tmp/exports [--x1] [--x2] [--trim]
#
# 选项:
#   --psd <path>       PSD 文件路径（必填）
#   --names <str>      图层组名称，逗号分隔（必填，如 "组84,组 85"）
#   --output <dir>     输出目录（必填）
#   --x1               导出 1x（默认开启）
#   --x2               导出 2x（默认关闭）
#   --no-x1            关闭 1x
#   --no-x2            关闭 2x
#   --trim             裁剪透明边（默认开启）
#   --no-trim          关闭裁剪
#   -h, --help         显示帮助
#
# 返回 JSON:
#   {
#     "ok": true/false,
#     "files": ["path1.png", ...],
#     "matched": 8, "ok": 8, "err": 0,
#     "outputDir": "/path",
#     "log": ["..."]
#   }
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_JSX="$SCRIPT_DIR/jsx/runner-export.jsx"

# ---- 默认值 ----
opt_psd=""
opt_names=""
opt_output=""
opt_x1=true
opt_x2=false
opt_trim=true

# ---- 解析参数 ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --psd)      shift; opt_psd="$1" ;;
        --names)    shift; opt_names="$1" ;;
        --output)   shift; opt_output="$1" ;;
        --x1)       opt_x1=true ;;
        --no-x1)    opt_x1=false ;;
        --x2)       opt_x2=true ;;
        --no-x2)    opt_x2=false ;;
        --trim)     opt_trim=true ;;
        --no-trim)  opt_trim=false ;;
        -h|--help)
            sed -n '/^# =====/,/^# =====/p' "$0" | sed '1d;$d' | sed 's/^# //; s/^#$//'
            exit 0
            ;;
        *) echo "未知选项: $1 (使用 --help 查看帮助)" >&2; exit 1 ;;
    esac
    shift
done

# ---- 校验 ----
if [[ -z "$opt_psd" ]]; then echo "错误: --psd 是必填项" >&2; exit 1; fi
if [[ -z "$opt_names" ]]; then echo "错误: --names 是必填项" >&2; exit 1; fi
if [[ -z "$opt_output" ]]; then echo "错误: --output 是必填项" >&2; exit 1; fi
if [[ ! -f "$opt_psd" ]]; then echo "错误: PSD 文件不存在: $opt_psd" >&2; exit 1; fi
if [[ ! -f "$RUNNER_JSX" ]]; then echo "错误: 找不到 runner-export.jsx" >&2; exit 1; fi

# ---- 构建参数 JSON（双引号转义供 JS 字面量嵌入） ----
# 将 names 转成 JSON 数组
IFS=',' read -ra name_arr <<< "$opt_names"
names_json="["
first=true
for n in "${name_arr[@]}"; do
    n="$(echo "$n" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    # 转义双引号和反斜杠
    n_esc="$(echo "$n" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    if $first; then first=false; else names_json+=","; fi
    names_json+='"'"$n_esc"'"'
done
names_json+="]"

# 转义 psd/output 路径中的双引号和反斜杠
psd_esc="$(echo "$opt_psd" | sed 's/\\/\\\\/g; s/"/\\"/g')"
output_esc="$(echo "$opt_output" | sed 's/\\/\\\\/g; s/"/\\"/g')"

# 构造完整 JSON 字符串
params_obj="{\"targetPath\":\"$psd_esc\",\"names\":$names_json,\"x1\":$opt_x1,\"x2\":$opt_x2,\"trim\":$opt_trim,\"outputDir\":\"$output_esc\"}"
# 双转义:嵌入 JS 字符串字面量时,内部的 " 必须转义为 \"
params_js="$(echo "$params_obj" | sed 's/\\/\\\\/g; s/"/\\"/g')"

# ---- 创建临时目录并组装 JSX ----
tmpdir="$(mktemp -d /tmp/ps2code-export-XXXXX)"
trap 'rm -rf "$tmpdir"' EXIT

jsx_file="$tmpdir/runner.jsx"

{
    echo "var PS2CODE_PARAMS = \"$params_js\";"
    cat "$RUNNER_JSX"
} > "$jsx_file"

# ---- 通过 osascript 在 Photoshop 中执行 ----
echo "--- 启动 Photoshop 导出 ---" >&2
echo "  PSD:  $opt_psd" >&2
echo "  组名: $opt_names" >&2
echo "  输出: $opt_output" >&2
echo "  1x: $opt_x1  2x: $opt_x2  裁剪: $opt_trim" >&2
echo "" >&2

# 检测 Photoshop 应用名
# 优先从 ~/.ps2code/config.json 的 psPath 读取(程序初始化写入的唯一真相源),
# 为空则自动扫描(覆盖顶层与子目录两种安装布局)。
# 应用名须与已安装版本完全一致,否则 AppleScript 报 -2741 编译错误。
source "$SCRIPT_DIR/lib/detect-ps.sh"
ps_app="$(ps_app_name)" || {
    echo '{"ok":false,"data":{},"log":[],"error":"未找到 Adobe Photoshop,请确认已安装或在应用设置中配置路径。"}'
    exit 1
}
echo "  应用: $ps_app" >&2

# 执行
raw_output="$(osascript -e '
tell application "'"$ps_app"'"
  do javascript (read POSIX file "'"$jsx_file"'" as «class utf8»)
end tell
' 2>/dev/null)" || {
    echo '{"ok":false,"data":{},"log":[],"error":"无法在 Photoshop 中执行脚本。请确保 Photoshop 正在运行。"}'
    exit 1
}

# ---- 解析返回 JSON ----
if [[ -z "$raw_output" ]]; then
    echo '{"ok":false,"data":{},"log":[],"error":"Photoshop 返回空结果"}'
    exit 1
fi

echo "$raw_output"

# ---- 后处理: TIFF → PNG ----
# 尝试用 Python 解析 JSON 获取文件列表（兼容新旧 macOS）
convert_tiffs() {
    local json="$1"
    local tiff_files=()

    # 用 grep 提取 .tif 文件路径
    while IFS= read -r line; do
        tiff_files+=("$line")
    done < <(echo "$json" | grep -o '"[^"]*\.tif"' | sed 's/"//g' || true)

    if [[ ${#tiff_files[@]} -eq 0 ]]; then return; fi

    echo "" >&2
    echo "--- 转换 TIFF → PNG ---" >&2
    for tif in "${tiff_files[@]}"; do
        png="${tif%.tif}.png"
        echo "  转换: $(basename "$tif") → $(basename "$png")" >&2
        if command -v sips &>/dev/null; then
            sips -s format png "$tif" --out "$png" &>/dev/null || true
        fi
    done
}

convert_tiffs "$raw_output"

# ---- 摘要 ----
echo "" >&2
echo "--- 导出完成 ---" >&2
echo "$raw_output" | grep -o '"log":\[[^]]*\]' | head -1 | sed 's/"log":\[//;s/\]//;s/","/\n/g; s/^"//;s/"$//' | while IFS= read -r line; do
    echo "  $line" >&2
done | tail -5

echo "  输出目录: $opt_output" >&2
