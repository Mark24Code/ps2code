#!/bin/bash
# 导出 PSD 中指定图层为 PNG(按 PSD 原生 id 精确定位)
#
# 用法:
#   ./scripts/export-groups.sh --psd <path> --targets-file <json> --output-dir <dir> [--1x] [--2x] [--trim]
#
# targets-file: JSON 数组 [{ "psId": 12, "name": "叶子名", "exportName": "叶子名_12" }, ...]
#   psId 缺失时按 name 回退定位;exportName 为最终文件名基名(叶子名_节点id)。
#
# 依赖: Adobe Photoshop (macOS)
# 输出: stdout 输出 JSON { ok, data:{files,meta,matched,ok,err,outputDir}, log, error }

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---- 默认值 ----
PSD_PATH=""
TARGETS_FILE=""
OUTPUT_DIR=""
OPT_X1="false"
OPT_X2="false"
OPT_TRIM="false"

# ---- 解析参数 ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --psd) PSD_PATH="$2"; shift 2 ;;
        --targets-file) TARGETS_FILE="$2"; shift 2 ;;
        --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
        --1x) OPT_X1="true"; shift ;;
        --2x) OPT_X2="true"; shift ;;
        --trim) OPT_TRIM="true"; shift ;;
        --help|-h)
            echo "用法: $0 --psd <path> --targets-file <json> --output-dir <dir> [--1x] [--2x] [--trim]"
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
if [[ -z "$TARGETS_FILE" ]]; then
    echo '{"ok":false,"data":{},"log":[],"error":"缺少 --targets-file 参数"}'
    exit 1
fi
if [[ ! -f "$TARGETS_FILE" ]]; then
    echo '{"ok":false,"data":{},"log":[],"error":"targets 文件不存在"}'
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

echo "=== 导出图层(按 id 定位) ===" >&2
echo "PSD : $PSD_PATH" >&2
echo "targets: $TARGETS_FILE" >&2
echo "输出: $OUTPUT_DIR" >&2
echo "1x: $OPT_X1  2x: $OPT_X2  trim: $OPT_TRIM" >&2
echo "" >&2

# ---- sed 替换值转义(处理 \  &  以及分隔符 |) ----
_escape_sed() {
    printf '%s\n' "$1" | sed 's/[\|&]/\\&/g'
}

# targets JSON 原文(作为 JS 字面量注入)
TARGETS_JSON="$(cat "$TARGETS_FILE")"

# ---- 临时文件 ----
TMP_JSX="/tmp/ps2code-export-groups.$$.jsx"
TMP_AS="/tmp/ps2code-export-groups.$$.applescript"
trap 'rm -f "$TMP_JSX" "$TMP_AS"' EXIT

# ---- 生成 JSX (自包含,无外部依赖) ----
cat > "$TMP_JSX" << 'JSXEOF'
(function(){
    // ---- 占位符(由 sed 替换为实际值) ----
    var PSD_PATH  = 'PSD_PATH_PLACEHOLDER';
    var OUT_DIR   = 'OUT_DIR_PLACEHOLDER';
    var TARGETS   = TARGETS_PLACEHOLDER;   // [{ psId?, name, exportName }]
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
    var doc = null;
    var didOpen = false;
    try {
        // 1. 打开或复用文档
        var f = new File(PSD_PATH);
        if (!f.exists) throw new Error('文件不存在: ' + PSD_PATH);
        for (var di = 0; di < app.documents.length; di++) {
            try {
                if (app.documents[di].fullName && app.documents[di].fullName.fsName === f.fsName) {
                    doc = app.documents[di];
                    break;
                }
            } catch(e2) {}
        }
        if (doc === null) { doc = app.open(f); didOpen = true; }
        app.activeDocument = doc;
        PS2._push("已打开: " + doc.name);

        // 2. 按 PSD 原生 id 选中图层(嵌套组内同样有效),失败返回 null
        function selectLayerById(layerId) {
            try {
                var ref = new ActionReference();
                ref.putIdentifier(charIDToTypeID("Lyr "), layerId);
                var desc = new ActionDescriptor();
                desc.putReference(charIDToTypeID("null"), ref);
                desc.putBoolean(charIDToTypeID("MkVs"), false);
                executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
                return doc.activeLayer;
            } catch (e) { return null; }
        }
        // 回退:按名递归查找第一个匹配图层/组
        function findAnyByName(container, name) {
            for (var i = 0; i < container.layers.length; i++) {
                var l = container.layers[i];
                if (l.name === name) return l;
                if (l.typename === 'LayerSet') {
                    var r = findAnyByName(l, name);
                    if (r) return r;
                }
            }
            return null;
        }

        // 2.5 文件系统防覆盖:同名 .png 自动递增序号
        function resolveUniqueName(dir, baseName) {
            var uf = new File(dir + '/' + baseName + '.png');
            if (!uf.exists) return baseName;
            var seq = 1;
            while (true) {
                var seqStr = String(seq);
                while (seqStr.length < 2) seqStr = "0" + seqStr;
                var candidate = baseName + '_' + seqStr;
                uf = new File(dir + '/' + candidate + '.png');
                if (!uf.exists) return candidate;
                seq++;
            }
        }

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
        var meta = [];
        var ok = 0, err = 0;

        // 导出单个图层/组:layerObj 已选中为 activeLayer,exportName 为最终基名
        function exportOne(layerObj, exportName) {
            var uniqueName = resolveUniqueName(OUT_DIR, exportName);
            if (uniqueName !== exportName) PS2._push("  文件已存在,重命名为: " + uniqueName);
            var saved = [];
            PS2._push("--- 处理: " + layerObj.name + " -> " + uniqueName);

            doc.activeLayer = layerObj;
            var dup = layerObj.duplicate();
            doc.activeLayer = dup;
            executeAction(stringIDToTypeID('newPlacedLayer'), undefined, DialogModes.NO);
            var sm = doc.activeLayer;
            PS2._push("  已转为智能对象");

            var b = sm.bounds;
            var w = Math.ceil(b[2].value - b[0].value);
            var h = Math.ceil(b[3].value - b[1].value);
            var gx = Math.round(b[0].value);
            var gy = Math.round(b[1].value);
            PS2._push("  图层尺寸: " + w + " x " + h + " px  @" + gx + "," + gy);
            if (w <= 0 || h <= 0) {
                PS2._push("  跳过: 图层为空或全部隐藏");
                sm.remove();
                return null;
            }

            var td = app.documents.add(
                Math.ceil(doc.width.value), Math.ceil(doc.height.value), 72,
                '_tmp_' + uniqueName, NewDocumentMode.RGB, DocumentFill.TRANSPARENT
            );
            app.activeDocument = doc;
            sm.duplicate(td, ElementPlacement.PLACEATBEGINNING);
            try { sm.remove(); } catch(e2) {}
            app.activeDocument = td;

            if (OPT_TRIM) {
                try {
                    td.trim(TrimType.TRANSPARENT, true, true, true, true);
                    PS2._push("  裁剪后: " + Math.ceil(td.width.value) + " x " + Math.ceil(td.height.value) + " px");
                } catch(e3) {
                    PS2._push("  裁剪失败(继续导出): " + e3.message);
                }
            }

            if (OPT_X1) {
                var f1x = exportPng(td, OUT_DIR + '/' + uniqueName + '.png');
                PS2._push("  ✓ 1x PNG: " + f1x.fsName);
                saved.push(f1x.fsName);
                meta.push({ file: f1x.name, group: layerObj.name, w: Math.ceil(td.width.value), h: Math.ceil(td.height.value), x: gx, y: gy });
            }

            if (OPT_X2) {
                var tw = Math.ceil(td.width.value);
                var th = Math.ceil(td.height.value);
                try {
                    td.resizeImage(UnitValue(tw * 2, "px"), UnitValue(th * 2, "px"), 72, ResampleMethod.BICUBIC);
                } catch(e4) {
                    PS2._push("  BICUBIC 2x 失败: " + e4.message + ", 尝试 BILINEAR");
                    try { td.resizeImage(UnitValue(tw * 2, "px"), UnitValue(th * 2, "px"), 72, ResampleMethod.BILINEAR); } catch(e5) {
                        PS2._push("  BILINEAR 也失败, 跳过 2x: " + e5.message);
                    }
                }
                var f2x = exportPng(td, OUT_DIR + '/' + uniqueName + '@2x.png');
                PS2._push("  ✓ 2x PNG: " + f2x.fsName);
                saved.push(f2x.fsName);
                meta.push({ file: f2x.name, group: layerObj.name, w: Math.ceil(td.width.value), h: Math.ceil(td.height.value), x: gx, y: gy });
            }

            td.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = doc;
            PS2._push("  ✓ 完成: " + uniqueName);
            return saved;
        }

        // 3. 逐个目标导出(按 psId 定位,回退按名)
        for (var i = 0; i < TARGETS.length; i++) {
            var t = TARGETS[i];
            try {
                var layerObj = null;
                if (typeof t.psId === "number" && t.psId > 0) {
                    layerObj = selectLayerById(t.psId);
                    if (!layerObj) PS2._push("  按 id " + t.psId + " 未定位到,回退按名 '" + t.name + "'");
                }
                if (!layerObj) layerObj = findAnyByName(doc, t.name);
                if (!layerObj) {
                    PS2._push("✕ 未找到目标: " + t.name + " (id=" + t.psId + ")");
                    err++;
                    continue;
                }
                var saved = exportOne(layerObj, t.exportName);
                if (saved && saved.length > 0) {
                    for (var fi = 0; fi < saved.length; fi++) files.push(saved[fi]);
                    ok++;
                } else {
                    err++;
                }
            } catch(e) {
                err++;
                PS2._push("✕ 失败 [" + t.exportName + "]: " + e.message + (e.line ? " (line " + e.line + ")" : ""));
                try { app.activeDocument = doc; } catch(e2) {}
            }
        }

        if (didOpen) doc.close(SaveOptions.DONOTSAVECHANGES);
        PS2._push("══════════════════════");
        PS2._push("导出完成! 成功: " + ok + "  失败: " + err);

        return PS2.result(true, { files: files, meta: meta, matched: ok + err, ok: ok, err: err, outputDir: OUT_DIR });
    } catch(e) {
        if (didOpen && doc) try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch(e2) {}
        return PS2.result(false, {}, e.message + (e.line ? " (line " + e.line + ")" : ""));
    } finally {
        app.preferences.rulerUnits = origUnit;
    }
})();
JSXEOF

# ---- sed 注入占位符 ----
PSD_PATH_ESC="$(_escape_sed "$PSD_PATH")"
OUT_DIR_ESC="$(_escape_sed "$OUTPUT_DIR")"
TARGETS_ESC="$(_escape_sed "$TARGETS_JSON")"

sed -i '' "s|PSD_PATH_PLACEHOLDER|$PSD_PATH_ESC|g"   "$TMP_JSX"
sed -i '' "s|OUT_DIR_PLACEHOLDER|$OUT_DIR_ESC|g"     "$TMP_JSX"
sed -i '' "s|TARGETS_PLACEHOLDER|$TARGETS_ESC|g"     "$TMP_JSX"
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
