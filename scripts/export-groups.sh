#!/bin/bash
# 导出 PSD 中指定图层组为 PNG
#
# 用法:
#   ./scripts/export-groups.sh --psd <path> --names <name1,name2> --output-dir <dir> [--1x] [--2x] [--trim]
#
# 依赖: Adobe Photoshop (macOS)
# 输出: stdout 输出 JSON { ok, data:{files,matched,ok,err,outputDir}, log, error }

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---- 默认值 ----
PSD_PATH=""
NAMES=""
OUTPUT_DIR=""
OPT_X1="false"
OPT_X2="false"
OPT_TRIM="false"

# ---- 解析参数 ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --psd) PSD_PATH="$2"; shift 2 ;;
        --names) NAMES="$2"; shift 2 ;;
        --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
        --1x) OPT_X1="true"; shift ;;
        --2x) OPT_X2="true"; shift ;;
        --trim) OPT_TRIM="true"; shift ;;
        --help|-h)
            echo "用法: $0 --psd <path> --names <name1,name2> --output-dir <dir> [--1x] [--2x] [--trim]"
            exit 0
            ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

# ---- 校验必填参数 ----
if [[ -z "$PSD_PATH" ]]; then
    echo '{"ok":false,"data":{},"log":[],"error":"缺少 --psd 参数"}'
    exit 1
fi
if [[ -z "$NAMES" ]]; then
    echo '{"ok":false,"data":{},"log":[],"error":"缺少 --names 参数"}'
    exit 1
fi
if [[ -z "$OUTPUT_DIR" ]]; then
    echo '{"ok":false,"data":{},"log":[],"error":"缺少 --output-dir 参数"}'
    exit 1
fi

# 如果没有指定任何比例,默认开启 1x
if [[ "$OPT_X1" == "false" && "$OPT_X2" == "false" ]]; then
    OPT_X1="true"
fi

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

echo "=== 导出图层组 ===" >&2
echo "PSD : $PSD_PATH" >&2
echo "图层组: $NAMES" >&2
echo "输出: $OUTPUT_DIR" >&2
echo "1x: $OPT_X1  2x: $OPT_X2  trim: $OPT_TRIM" >&2
echo "" >&2

# ---- sed 替换值转义(处理 \  &  以及分隔符 |) ----
_escape_sed() {
    printf '%s\n' "$1" | sed 's/[\|&]/\\&/g'
}

# ---- 将逗号分隔的名称转为 JS 数组字面量 ----
_build_js_array() {
    local result="["
    local first=true
    # 保存原 IFS
    local OLD_IFS="$IFS"
    IFS=','
    for name in $1; do
        # 去除前后空白
        name="$(printf '%s' "$name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        # 转义单引号(图层名中极少出现,但做预防)
        local escaped="${name//\'/\'\\\'\'}"
        if $first; then
            result="${result}'${escaped}'"
            first=false
        else
            result="${result},'${escaped}'"
        fi
    done
    IFS="$OLD_IFS"
    result="${result}]"
    printf '%s' "$result"
}

NAMES_JS="$(_build_js_array "$NAMES")"

# ---- 临时文件 ----
TMP_JSX="/tmp/ps2code-export-groups.$$.jsx"
TMP_AS="/tmp/ps2code-export-groups.$$.applescript"
trap 'rm -f "$TMP_JSX" "$TMP_AS"' EXIT

# ---- 生成 JSX (自包含,无外部依赖) ----
# 注意: heredoc 使用 'JSXEOF' (单引号定界) 阻止 shell 变量展开,
#       所有占位符后续由 sed 替换。
cat > "$TMP_JSX" << 'JSXEOF'
(function(){
    // ---- 占位符(由 sed 替换为实际值) ----
    var PSD_PATH  = 'PSD_PATH_PLACEHOLDER';
    var OUT_DIR   = 'OUT_DIR_PLACEHOLDER';
    var NAMES     = NAMES_PLACEHOLDER;
    var OPT_X1    = X1_PLACEHOLDER;
    var OPT_X2    = X2_PLACEHOLDER;
    var OPT_TRIM  = TRIM_PLACEHOLDER;

    // ---- 最小 PS2 辅助(无需外部 _common.jsxinc) ----
    var PS2 = {};
    PS2.log = [];
    PS2._push = function(m) { PS2.log.push(String(m)); };
    PS2.stringify = function(obj) {
        function esc(s) {
            s = String(s);
            return s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")
                    .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
        }
        function ser(v) {
            if (v === null || v === undefined) return "null";
            var t = typeof v;
            if (t === "number") return isFinite(v) ? String(v) : "null";
            if (t === "boolean") return v ? "true" : "false";
            if (t === "string") return '"' + esc(v) + '"';
            if (v instanceof Array) {
                var a = [];
                for (var i = 0; i < v.length; i++) a.push(ser(v[i]));
                return "[" + a.join(",") + "]";
            }
            var parts = [];
            for (var k in v) {
                if (v.hasOwnProperty(k)) parts.push('"' + esc(k) + '":' + ser(v[k]));
            }
            return "{" + parts.join(",") + "}";
        }
        return ser(obj);
    };
    PS2.result = function(ok, data, error) {
        return PS2.stringify({ ok: ok, data: data || {}, log: PS2.log, error: error || "" });
    };

    var origUnit = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    try {
        // 1. 打开或复用文档(如果 PSD 已在 PS 中打开则复用,避免 "file already open" 错误)
        var f = new File(PSD_PATH);
        if (!f.exists) throw new Error('文件不存在: ' + PSD_PATH);
        var doc = null;
        var didOpen = false;
        for (var di = 0; di < app.documents.length; di++) {
            try {
                if (app.documents[di].fullName && app.documents[di].fullName.fsName === f.fsName) {
                    doc = app.documents[di];
                    break;
                }
            } catch(e2) {}
        }
        if (doc === null) {
            doc = app.open(f);
            didOpen = true;
        }
        app.activeDocument = doc;
        PS2._push("已打开: " + doc.name);

        // 2. 递归查找图层组
        function findLayerSet(container, name) {
            for (var i = 0; i < container.layers.length; i++) {
                var l = container.layers[i];
                if (l.typename === 'LayerSet' && l.name === name) return l;
                if (l.typename === 'LayerSet') {
                    var r = findLayerSet(l, name);
                    if (r) return r;
                }
            }
            return null;
        }

        // 3. 导出为 PNG(SAVEFORWEB,与 export-group-84.sh 一致)
        function exportPng(targetDoc, filePath) {
            var outFile = new File(filePath);
            var outDir = new Folder(outFile.parent.fsName);
            if (!outDir.exists) outDir.create();
            var opts = new ExportOptionsSaveForWeb();
            opts.format       = SaveDocumentType.PNG;
            opts.PNG8         = false;
            opts.transparency = true;
            opts.interlaced   = false;
            opts.quality      = 100;
            targetDoc.exportDocument(outFile, ExportType.SAVEFORWEB, opts);
            return outFile;
        }

        var files = [];
        var ok = 0, err = 0;

        // 4. 逐个导出
        for (var gi = 0; gi < NAMES.length; gi++) {
            var groupName = NAMES[gi];
            try {
                PS2._push("--- 处理: " + groupName);

                var g = findLayerSet(doc, groupName);
                if (!g) {
                    PS2._push("  未找到图层组 '" + groupName + "', 跳过");
                    err++;
                    continue;
                }

                // 4a. 复制 → 智能对象(与 export-group-84.sh 第78-82行一致)
                doc.activeLayer = g;
                var dup = g.duplicate();
                doc.activeLayer = dup;
                executeAction(stringIDToTypeID('newPlacedLayer'), undefined, DialogModes.NO);
                var sm = doc.activeLayer;
                PS2._push("  已转为智能对象");

                // 4b. 校验非空
                var b = sm.bounds;
                var w = Math.ceil(b[2].value - b[0].value);
                var h = Math.ceil(b[3].value - b[1].value);
                PS2._push("  图层尺寸: " + w + " x " + h + " px");
                if (w <= 0 || h <= 0) {
                    PS2._push("  跳过: 图层组为空或全部隐藏");
                    sm.remove();
                    err++;
                    continue;
                }

                // 4c. 创建与原文档等尺寸的临时文档
                var td = app.documents.add(
                    Math.ceil(doc.width.value), Math.ceil(doc.height.value), 72,
                    '_tmp_' + groupName, NewDocumentMode.RGB, DocumentFill.TRANSPARENT
                );
                app.activeDocument = doc;
                sm.duplicate(td, ElementPlacement.PLACEATBEGINNING);
                try { sm.remove(); } catch(e2) {}
                app.activeDocument = td;

                // 4d. 裁剪透明像素
                if (OPT_TRIM) {
                    try {
                        td.trim(TrimType.TRANSPARENT, true, true, true, true);
                        PS2._push("  裁剪后: " + Math.ceil(td.width.value) + " x " + Math.ceil(td.height.value) + " px");
                    } catch(e3) {
                        PS2._push("  裁剪失败(继续导出): " + e3.message);
                    }
                }

                // 4e. 导出 1x
                var saved = [];
                if (OPT_X1) {
                    var f1x = exportPng(td, OUT_DIR + '/' + groupName + '.png');
                    PS2._push("  ✓ 1x PNG: " + f1x.fsName);
                    saved.push(f1x.fsName);
                }

                // 4f. 导出 2x(放大两倍后导出)
                if (OPT_X2) {
                    var tw = Math.ceil(td.width.value);
                    var th = Math.ceil(td.height.value);
                    try {
                        td.resizeImage(
                            UnitValue(tw * 2, "px"),
                            UnitValue(th * 2, "px"), 72, ResampleMethod.BICUBIC
                        );
                    } catch(e4) {
                        PS2._push("  BICUBIC 2x 失败: " + e4.message + ", 尝试 BILINEAR");
                        try {
                            td.resizeImage(
                                UnitValue(tw * 2, "px"),
                                UnitValue(th * 2, "px"), 72, ResampleMethod.BILINEAR
                            );
                        } catch(e5) {
                            PS2._push("  BILINEAR 也失败, 跳过 2x: " + e5.message);
                        }
                    }
                    var f2x = exportPng(td, OUT_DIR + '/' + groupName + '@2x.png');
                    PS2._push("  ✓ 2x PNG: " + f2x.fsName);
                    saved.push(f2x.fsName);
                }

                // 4g. 清理临时文档,切回原文档
                td.close(SaveOptions.DONOTSAVECHANGES);
                app.activeDocument = doc;

                for (var fi = 0; fi < saved.length; fi++) {
                    files.push(saved[fi]);
                }
                ok++;
                PS2._push("  ✓ 完成: " + groupName);

            } catch(e) {
                err++;
                PS2._push("✕ 失败 [" + groupName + "]: " + e.message + (e.line ? " (line " + e.line + ")" : ""));
                try { app.activeDocument = doc; } catch(e2) {}
            }
        }

        if (didOpen) doc.close(SaveOptions.DONOTSAVECHANGES);
        PS2._push("══════════════════════");
        PS2._push("导出完成! 成功: " + ok + "  失败: " + err);
        return PS2.result(true, { files: files, matched: NAMES.length, ok: ok, err: err, outputDir: OUT_DIR });
    } catch(e) {
        if (didOpen) try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch(e2) {}
        return PS2.result(false, {}, e.message + (e.line ? " (line " + e.line + ")" : ""));
    } finally {
        app.preferences.rulerUnits = origUnit;
    }
})();
JSXEOF

# ---- sed 注入占位符 ----
PSD_PATH_ESC="$(_escape_sed "$PSD_PATH")"
OUT_DIR_ESC="$(_escape_sed "$OUTPUT_DIR")"
NAMES_JS_ESC="$(_escape_sed "$NAMES_JS")"

sed -i '' "s|PSD_PATH_PLACEHOLDER|$PSD_PATH_ESC|g"   "$TMP_JSX"
sed -i '' "s|OUT_DIR_PLACEHOLDER|$OUT_DIR_ESC|g"     "$TMP_JSX"
sed -i '' "s|NAMES_PLACEHOLDER|$NAMES_JS_ESC|g"      "$TMP_JSX"
sed -i '' "s|X1_PLACEHOLDER|$OPT_X1|g"               "$TMP_JSX"
sed -i '' "s|X2_PLACEHOLDER|$OPT_X2|g"               "$TMP_JSX"
sed -i '' "s|TRIM_PLACEHOLDER|$OPT_TRIM|g"           "$TMP_JSX"

# ---- 检测 Photoshop 应用名 ----
source "$SCRIPT_DIR/lib/detect-ps.sh"
PS_APP="$(ps_app_name)" || {
    echo '{"ok":false,"data":{},"log":[],"error":"未找到 Adobe Photoshop，请确认已安装或在应用设置中配置路径"}'
    exit 1
}
echo "PS 应用: $PS_APP" >&2

# ---- 生成 AppleScript ----
cat > "$TMP_AS" << APPLESCRIPT
tell application "$PS_APP"
    do javascript file "$TMP_JSX"
end tell
APPLESCRIPT

# ---- 执行 ----
osascript "$TMP_AS" 2>&1 || {
    echo '{"ok":false,"data":{},"log":[],"error":"osascript 执行失败，请确保 Adobe Photoshop 已打开"}'
    exit 1
}
