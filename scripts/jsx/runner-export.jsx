// ============================================================================
// runner-export.jsx — Shell 驱动的图层组导出脚本（无 UI、纯 JSON 输出）
//
// 用法（由 shell 脚本调用）：
//   1. 在 shell 中构造临时 JSX 文件：
//      cat _common.jsxinc > /tmp/run.jsx
//      echo 'var PS2CODE_PARAMS = "{...}";' >> /tmp/run.jsx
//      cat runner-export.jsx >> /tmp/run.jsx
//   2. 通过 osascript 执行：
//      osascript -e 'tell app "Adobe Photoshop" to do javascript (read POSIX file "/tmp/run.jsx" as «class utf8»)'
//
// PS2CODE_PARAMS 格式：
//   { targetPath, names:[], x1, x2, trim, outputDir }
//
// 返回 JSON：
//   { ok: true/false, data: { files:[], matched, ok, err, outputDir }, log:[], error:"" }
// ============================================================================

// ============================================================================
//  公共函数（_common.jsxinc 内联）
// ============================================================================

if (typeof String.prototype.trim !== "function") {
    String.prototype.trim = function () {
        return this.replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, "");
    };
}

var PS2 = {};
PS2.log = [];
PS2._push = function (m) { PS2.log.push(String(m)); };

PS2.stringify = function (obj) {
    function esc(s) {
        s = String(s);
        return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
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

PS2.result = function (ok, data, error) {
    return PS2.stringify({ ok: ok, data: data || {}, log: PS2.log, error: error || "" });
};

PS2.openOrReuse = function (targetPath) {
    var doc = null;
    for (var d = 0; d < app.documents.length; d++) {
        try {
            if (app.documents[d].fullName.fsName === new File(targetPath).fsName) {
                doc = app.documents[d];
                break;
            }
        } catch (e) {}
    }
    if (doc === null) {
        var f = new File(targetPath);
        if (!f.exists) throw new Error("文件不存在: " + targetPath);
        doc = app.open(f);
    }
    app.activeDocument = doc;
    return doc;
};

PS2.findAllLayerSets = function (container) {
    var result = [];
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        if (layer.typename === "LayerSet") {
            result.push(layer);
            result = result.concat(PS2.findAllLayerSets(layer));
        }
    }
    return result;
};

PS2.params = function () {
    if (typeof PS2CODE_PARAMS === "undefined") return {};
    return eval("(" + PS2CODE_PARAMS + ")");
};

// ============================================================================
//  导出函数（与 export-groups.jsx 一致）
// ============================================================================

function convertToSmartObject() {
    executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
}

function exportLayerToFile(d, basePath) {
    try {
        var pngFile = new File(basePath + ".png");
        var opts = new ExportOptionsSaveForWeb();
        opts.format       = SaveDocumentType.PNG;
        opts.PNG8         = false;
        opts.transparency = true;
        opts.interlaced   = false;
        opts.quality      = 100;
        d.exportDocument(pngFile, ExportType.SAVEFORWEB, opts);
        PS2._push("  ✓ PNG: " + pngFile.fsName);
        return pngFile;
    } catch (e) {
        PS2._push("  PNG(SAVEFORWEB)不兼容(" + e.message + "),尝试 TIFF…");
    }
    try {
        var tifFile = new File(basePath + ".tif");
        var tifOpt = new TiffSaveOptions();
        tifOpt.transparency = true;
        tifOpt.layers = false;
        d.saveAs(tifFile, tifOpt, true);
        PS2._push("  ✓ TIFF: " + tifFile.fsName);
        return tifFile;
    } catch (e) {
        PS2._push("  TIFF 也不兼容(" + e.message + "),尝试 PSD…");
    }
    try {
        var psdFile = new File(basePath + ".psd");
        var psdOpt = new PhotoshopSaveOptions();
        psdOpt.layers = false;
        d.saveAs(psdFile, psdOpt, true);
        PS2._push("  ✓ PSD: " + psdFile.fsName);
        return psdFile;
    } catch (e) {
        throw new Error("所有导出方法均失败: " + e.message);
    }
}

function exportOneGroup(doc, groupLayer, exportDir, outName, optX1, optX2, optTrim) {
    var savedFiles = [];
    PS2._push("--- 处理: " + groupLayer.name + (outName !== groupLayer.name ? " → " + outName : ""));
    doc.activeLayer = groupLayer;
    var duplicated = groupLayer.duplicate();
    PS2._push("  已复制图层组");
    doc.activeLayer = duplicated;
    try {
        convertToSmartObject();
    } catch (e) {
        PS2._push("  convertToSmartObject 失败 → 尝试回退方案");
        duplicated.remove();
        return exportOneGroupFallback(doc, groupLayer, exportDir, outName, optX1, optX2, optTrim);
    }
    var mergedLayer = doc.activeLayer;
    PS2._push("  已转为智能对象");
    var b = mergedLayer.bounds;
    var w = Math.ceil(b[2].value - b[0].value);
    var h = Math.ceil(b[3].value - b[1].value);
    PS2._push("  图层尺寸: " + w + " × " + h + " px");
    if (w <= 0 || h <= 0) {
        PS2._push("  跳过:图层组为空或全部隐藏");
        mergedLayer.remove();
        return savedFiles;
    }
    var tempDoc = app.documents.add(
        Math.ceil(doc.width.value), Math.ceil(doc.height.value), 72,
        outName, NewDocumentMode.RGB, DocumentFill.TRANSPARENT
    );
    app.activeDocument = doc;
    mergedLayer.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);
    PS2._push("  已复制到临时文档");
    try { mergedLayer.remove(); } catch (e) {
        PS2._push("  移除副本失败(继续): " + e.message);
    }
    app.activeDocument = tempDoc;
    if (optTrim) {
        try {
            tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true);
            PS2._push("  裁剪后: " + Math.ceil(tempDoc.width.value) + " × " + Math.ceil(tempDoc.height.value) + " px");
        } catch (e) {
            PS2._push("  裁剪失败(继续): " + e.message);
        }
    }
    if (optX1) {
        var f1 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + outName);
        if (f1) savedFiles.push(f1.fsName);
    }
    if (optX2) {
        var tw = Math.ceil(tempDoc.width.value);
        var th = Math.ceil(tempDoc.height.value);
        try {
            tempDoc.resizeImage(UnitValue(tw * 2, "px"), UnitValue(th * 2, "px"), 72, ResampleMethod.BICUBIC);
        } catch (e) {
            PS2._push("  BICUBIC 2x 缩放失败,尝试 BILINEAR…");
            try { tempDoc.resizeImage(UnitValue(tw * 2, "px"), UnitValue(th * 2, "px"), 72, ResampleMethod.BILINEAR); } catch (e2) {
                PS2._push("  BILINEAR 也失败,跳过 2x");
            }
        }
        var f2 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + outName + "@2x");
        if (f2) savedFiles.push(f2.fsName);
    }
    tempDoc.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = doc;
    PS2._push("  ✓ 完成: " + outName);
    return savedFiles;
}

function exportOneGroupFallback(doc, groupLayer, exportDir, outName, optX1, optX2, optTrim) {
    var savedFiles = [];
    PS2._push("  [回退] 使用 mergeVisibleLayers 方案");
    doc.activeLayer = groupLayer;
    var duplicated = groupLayer.duplicate();
    var tempDoc = app.documents.add(
        Math.ceil(doc.width.value), Math.ceil(doc.height.value), 72,
        outName, NewDocumentMode.RGB, DocumentFill.TRANSPARENT
    );
    app.activeDocument = doc;
    duplicated.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);
    try { duplicated.remove(); } catch (e) {}
    app.activeDocument = tempDoc;
    (function ensureAllVisible(container) {
        for (var li = 0; li < container.layers.length; li++) {
            container.layers[li].visible = true;
            if (container.layers[li].typename === "LayerSet") {
                ensureAllVisible(container.layers[li]);
            }
        }
    })(tempDoc);
    try {
        tempDoc.mergeVisibleLayers();
    } catch (e) {
        PS2._push("  [回退] mergeVisibleLayers 失败: " + e.message);
    }
    if (optTrim) { try { tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true); } catch (e) {} }
    if (optX1) {
        var f1 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + outName);
        if (f1) savedFiles.push(f1.fsName);
    }
    if (optX2) {
        var tw = Math.ceil(tempDoc.width.value), th = Math.ceil(tempDoc.height.value);
        try { tempDoc.resizeImage(UnitValue(tw * 2, "px"), UnitValue(th * 2, "px"), 72, ResampleMethod.BICUBIC); } catch (e) {}
        var f2 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + outName + "@2x");
        if (f2) savedFiles.push(f2.fsName);
    }
    tempDoc.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = doc;
    PS2._push("  ✓ [回退] 完成: " + outName);
    return savedFiles;
}

// ============================================================================
//  Main — 由 shell 注入 PS2CODE_PARAMS
// ============================================================================

(function () {
    var originalUnit = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    try {
        var p = PS2.params();
        var doc = PS2.openOrReuse(p.targetPath);

        var exportDir = new Folder(p.outputDir);
        if (!exportDir.exists) exportDir.create();
        PS2._push("输出目录: " + exportDir.fsName);

        var allGroups = PS2.findAllLayerSets(doc);
        PS2._push("文档共 " + allGroups.length + " 个图层组");

        var nameSet = {};
        if (p.names && p.names.length) {
            for (var ni = 0; ni < p.names.length; ni++) nameSet[p.names[ni]] = true;
        }
        var matched = [];
        for (var i = 0; i < allGroups.length; i++) {
            if (nameSet[allGroups[i].name]) matched.push(allGroups[i]);
        }
        PS2._push("匹配到 " + matched.length + " 个图层组");
        if (matched.length === 0) {
            return PS2.result(true, { files: [], matched: 0, ok: 0, err: 0 });
        }

        var files = [];
        var ok = 0, err = 0;
        for (var m = 0; m < matched.length; m++) {
            try {
                var saved = exportOneGroup(doc, matched[m], exportDir, matched[m].name, p.x1, p.x2, p.trim);
                if (saved && saved.length > 0) {
                    for (var fi = 0; fi < saved.length; fi++) files.push(saved[fi]);
                }
                ok++;
            } catch (e) {
                err++;
                PS2._push("✕ 失败 [" + matched[m].name + "]: " + e.message + (e.line ? " (line " + e.line + ")" : ""));
                try { app.activeDocument = doc; } catch (e2) {}
            }
        }

        PS2._push("══════════════════════");
        PS2._push("导出完成! 成功: " + ok + "  失败: " + err);
        return PS2.result(true, { files: files, matched: matched.length, ok: ok, err: err, outputDir: exportDir.fsName });

    } catch (e) {
        return PS2.result(false, {}, e.message + (e.line ? " (line " + e.line + ")" : ""));
    } finally {
        app.preferences.rulerUnits = originalUnit;
    }
})();
