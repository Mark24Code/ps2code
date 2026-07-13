#!/bin/bash
# 导出 design-drafts/a签到.psd 中 "组 84" 图层为 PNG
#
# 用法:
#   ./scripts/export-group-84.sh
#   ./scripts/export-group-84.sh /path/to/output.png
#   ./scripts/export-group-84.sh --dir /some/dir
#
# 依赖: Adobe Photoshop (macOS)

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PSD_PATH="$PROJECT_DIR/design-drafts/a签到.psd"
LAYER_NAME="组 84"

# ---- 解析参数 ----
OUTPUT_PATH=""
OUTPUT_DIR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir) OUTPUT_DIR="$2"; shift 2 ;;
        --help|-h) echo "用法: $0 [--dir <目录> | <输出路径>]"; exit 0 ;;
        *) OUTPUT_PATH="$1"; shift ;;
    esac
done

if [[ -n "$OUTPUT_DIR" ]]; then
    mkdir -p "$OUTPUT_DIR"
    OUTPUT_PATH="$OUTPUT_DIR/$LAYER_NAME.png"
elif [[ -z "$OUTPUT_PATH" ]]; then
    OUTPUT_PATH="$PROJECT_DIR/$LAYER_NAME.png"
fi

OUTPUT_DIR="$(cd "$(dirname "$OUTPUT_PATH")" && pwd)"
OUTPUT_FILENAME="$(basename "$OUTPUT_PATH")"

echo "=== 导出 \"$LAYER_NAME\" ==="
echo "PSD : $PSD_PATH"
echo "输出: $OUTPUT_DIR/$OUTPUT_FILENAME"
echo ""

# ---- 临时文件（用 $$ 避免 mktemp 兼容性问题） ----
TMP_JSX="/tmp/export-group-84.$$.jsx"
TMP_AS="/tmp/export-group-84.$$.applescript"
trap 'rm -f "$TMP_JSX" "$TMP_AS"' EXIT

# ---- 生成 JSX ----
cat > "$TMP_JSX" << 'JSXEOF'
(function(){
    var PSD_PATH  = 'PSD_PATH_PLACEHOLDER';
    var OUT_DIR   = 'OUT_DIR_PLACEHOLDER';
    var OUT_NAME  = 'OUT_FILENAME_PLACEHOLDER';
    var LAYERNAME = 'LAYER_NAME_PLACEHOLDER';

    var origUnit = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    try {
        // 1. 打开文档
        var f = new File(PSD_PATH);
        if (!f.exists) throw new Error('文件不存在: ' + PSD_PATH);
        var doc = app.open(f);
        app.activeDocument = doc;

        // 2. 递归查找图层组
        function find(ct, n) {
            for (var i = 0; i < ct.layers.length; i++) {
                var l = ct.layers[i];
                if (l.typename === 'LayerSet' && l.name === n) return l;
                if (l.typename === 'LayerSet') { var r = find(l, n); if (r) return r; }
            }
            return null;
        }
        var g = find(doc, LAYERNAME);
        if (!g) throw new Error('未找到图层组: ' + LAYERNAME);

        // 3. 复制 → 智能对象
        doc.activeLayer = g;
        var dup = g.duplicate();
        doc.activeLayer = dup;
        executeAction(stringIDToTypeID('newPlacedLayer'), undefined, DialogModes.NO);
        var sm = doc.activeLayer;

        // 4. 临时文档
        var b = sm.bounds;
        if (b[2].value - b[0].value <= 0 || b[3].value - b[1].value <= 0)
            throw new Error('图层为空');
        var td = app.documents.add(
            Math.ceil(doc.width.value), Math.ceil(doc.height.value), 72,
            '_tmp', NewDocumentMode.RGB, DocumentFill.TRANSPARENT
        );
        app.activeDocument = doc;
        sm.duplicate(td, ElementPlacement.PLACEATBEGINNING);
        try { sm.remove(); } catch(e){}
        app.activeDocument = td;
        try { td.trim(TrimType.TRANSPARENT, true, true, true, true); } catch(e){}

        // 5. 导出 PNG
        var outDir = new Folder(OUT_DIR);
        if (!outDir.exists) outDir.create();
        var of = new File(outDir.fsName + '/' + OUT_NAME);
        var o = new ExportOptionsSaveForWeb();
        o.format = SaveDocumentType.PNG;
        o.PNG8 = false;
        o.transparency = true;
        o.interlaced = false;
        o.quality = 100;
        td.exportDocument(of, ExportType.SAVEFORWEB, o);

        td.close(SaveOptions.DONOTSAVECHANGES);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    } catch(e) {
        alert('导出失败: ' + e.message + (e.line ? ' (行' + e.line + ')' : ''));
    }
    app.preferences.rulerUnits = origUnit;
})();
JSXEOF

# ---- 注入路径 ----
sed -i '' "s|PSD_PATH_PLACEHOLDER|$PSD_PATH|g" "$TMP_JSX"
sed -i '' "s|OUT_DIR_PLACEHOLDER|$OUTPUT_DIR|g" "$TMP_JSX"
sed -i '' "s|OUT_FILENAME_PLACEHOLDER|$OUTPUT_FILENAME|g" "$TMP_JSX"
sed -i '' "s|LAYER_NAME_PLACEHOLDER|$LAYER_NAME|g" "$TMP_JSX"

# ---- 检测 Photoshop 应用名 ----
# 优先从 ~/.ps2code/config.json 的 psPath 读取(程序初始化写入的唯一真相源),
# 为空则自动扫描;应用名须与已安装版本完全一致,否则 AppleScript 报 -2741。
source "$(dirname "$0")/lib/detect-ps.sh"
PS_APP="$(ps_app_name)" || {
    echo "✕ 失败: 未找到 Adobe Photoshop，请确认已安装或在应用设置中配置路径"
    exit 1
}

# ---- 生成 AppleScript ----
cat > "$TMP_AS" << APPLESCRIPT
tell application "$PS_APP"
    do javascript file "$TMP_JSX"
end tell
APPLESCRIPT

# ---- 执行 ----
osascript "$TMP_AS" 2>&1 || {
    echo "✕ 失败: 请确保 Adobe Photoshop 已打开"
    exit 1
}

echo ""
echo "✓ 导出完成: $OUTPUT_DIR/$OUTPUT_FILENAME"
