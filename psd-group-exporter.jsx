#target photoshop

/**
 * PSD Group Exporter — Photoshop Script
 *
 * 功能：
 * 1. 输入正则表达式，自动过滤所有匹配的图层组 (LayerSet)
 * 2. 递归合并每个匹配组的所有子节点到单个栅格图层
 * 3. 导出为 PNG-24，支持 1x 原图和 2x 高清图（2x 默认开启）
 * 4. 运行日志窗口，所有过程和报错一目了然
 */

// ============================================================================
//                              POLYFILLS
// ============================================================================

// ExtendScript 引擎基于 ES3，缺少 String.prototype.trim，
// 缺失会导致按钮 onClick 里 txt.trim() 抛异常且被静默吞掉（点击无反应）。
if (typeof String.prototype.trim !== "function") {
    String.prototype.trim = function () {
        return this.replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, "");
    };
}

// ============================================================================
//                              GLOBAL STATE
// ============================================================================

var g_logArea = null;   // 日志窗口的 edittext 控件引用

// ============================================================================
//                              LOG WINDOW
// ============================================================================

/**
 * 在「运行日志」窗口中追加一行文字。
 * 同时写入 ExtendScript 控制台 ($.writeln)。
 */
function log(msg) {
    $.writeln(msg);
    if (g_logArea && g_logArea.isValid) {
        try {
            g_logArea.text += msg + "\n";
        } catch (e) {
            // 控件失效则静默忽略
        }
    }
}

/**
 * 创建运行日志窗口（palette 类型，非阻塞）。
 * 用户可随时查看运行过程与报错信息。
 */
function createLogWindow() {
    var win = new Window("palette", "PSD Group Exporter - 运行日志");
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 8;
    win.margins = 12;

    // 标题
    var lbl = win.add("statictext", undefined, "导出日志（可滚动查看）：");
    lbl.alignment = "left";

    // 多行只读日志区域
    g_logArea = win.add("edittext", undefined, "", { multiline: true, readonly: true });
    g_logArea.preferredSize = [520, 380];
    g_logArea.alignment = "fill";

    // 关闭按钮
    var grpBtns = win.add("group");
    grpBtns.alignment = "right";
    var btnClose = grpBtns.add("button", undefined, "关闭");
    btnClose.onClick = function () {
        win.close();
    };

    win.show();
}

// ============================================================================
//                              SETTINGS DIALOG
// ============================================================================

function showDialog() {
    var win = new Window("dialog", "PSD Group Exporter");
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 12;
    win.margins = 20;

    // --- Header ---
    var pnlHeader = win.add("panel", undefined, undefined);
    pnlHeader.alignment = "fill";
    var lblTitle = pnlHeader.add("statictext", undefined, "PSD 图层组批量导出");
    lblTitle.alignment = "center";
    lblTitle.graphics.font = ScriptUI.newFont(lblTitle.graphics.font.name, "BOLD", 14);

    // --- Regex Input ---
    var grpRegex = win.add("group");
    grpRegex.orientation = "column";
    grpRegex.alignChildren = ["fill", "top"];
    grpRegex.spacing = 4;

    grpRegex.add("statictext", undefined, "正则表达式（匹配图层组名称）：");
    var txtRegex = grpRegex.add("edittext", undefined, "");
    txtRegex.active = true;
    txtRegex.helpTip = "例如： ^icon 匹配以 icon 开头的组\nbtn_.* 匹配包含 btn_ 的组\n\\.png$ 匹配以 .png 结尾的组";

    // --- Preview button ---
    var grpPreviewBtn = win.add("group");
    grpPreviewBtn.orientation = "row";
    grpPreviewBtn.alignChildren = ["left", "center"];
    grpPreviewBtn.spacing = 10;

    var btnPreview = grpPreviewBtn.add("button", undefined, "🔍 预览匹配结果");
    var lblPreviewCount = grpPreviewBtn.add("statictext", undefined, "（点击预览查看匹配的图层组）");

    // --- Preview area ---
    var pnlPreview = win.add("panel", undefined, "匹配结果预览");
    pnlPreview.orientation = "column";
    pnlPreview.alignChildren = ["fill", "top"];
    pnlPreview.spacing = 4;

    var txtPreview = pnlPreview.add("edittext", undefined, "", { multiline: true, readonly: true });
    txtPreview.preferredSize = [460, 120];
    txtPreview.alignment = "fill";

    btnPreview.onClick = function () {
      try {
        if (app.documents.length === 0) {
            txtPreview.text = "请先打开一个 PSD 文档。";
            lblPreviewCount.text = "";
            return;
        }
        var s = txtRegex.text.trim();
        if (s === "") {
            txtPreview.text = "请先输入正则表达式。";
            lblPreviewCount.text = "";
            return;
        }
        try {
            new RegExp(s);
        } catch (e) {
            txtPreview.text = "正则表达式无效: " + e.message;
            lblPreviewCount.text = "";
            return;
        }

        // 扫描文档中的 LayerSet
        var allGroups = findAllLayerSets(app.activeDocument);
        var regex = new RegExp(s);
        var matched = [];
        for (var i = 0; i < allGroups.length; i++) {
            if (regex.test(allGroups[i].name)) {
                matched.push(allGroups[i]);
            }
        }

        // 显示结果
        var previewText = "文档共 " + allGroups.length + " 个图层组，正则匹配到 " + matched.length + " 个：\n";
        previewText += "──────────────────────────────\n";
        if (matched.length === 0) {
            previewText += "（无匹配）\n\n所有图层组名称：\n";
            for (var j = 0; j < allGroups.length; j++) {
                previewText += "  • " + allGroups[j].name + "\n";
            }
        } else {
            for (var k = 0; k < matched.length; k++) {
                previewText += "  ✓ " + matched[k].name + "\n";
            }
            // 同时列出未匹配的
            var unmatched = [];
            for (var m = 0; m < allGroups.length; m++) {
                if (!regex.test(allGroups[m].name)) {
                    unmatched.push(allGroups[m]);
                }
            }
            if (unmatched.length > 0) {
                previewText += "\n未匹配的 " + unmatched.length + " 个：\n";
                for (var n = 0; n < unmatched.length; n++) {
                    previewText += "  ✗ " + unmatched[n].name + "\n";
                }
            }
        }

        txtPreview.text = previewText;
        lblPreviewCount.text = "匹配 " + matched.length + " / " + allGroups.length + " 个图层组";
      } catch (err) {
        alert("预览出错:\n" + err.message + "\n(line " + err.line + ")");
      }
    };

    // --- Export Options ---
    var pnlExport = win.add("panel", undefined, "导出选项");
    pnlExport.orientation = "column";
    pnlExport.alignChildren = ["left", "top"];
    pnlExport.spacing = 8;

    var cbExport1x = pnlExport.add("checkbox", undefined, "导出 1x 图");
    cbExport1x.value = false;
    cbExport1x.helpTip = "导出原始尺寸的图片";

    var cbExport2x = pnlExport.add("checkbox", undefined, "导出 2x 图（推荐）");
    cbExport2x.value = true;
    cbExport2x.helpTip = "导出 2 倍尺寸的图片，适用于 Retina / 高清屏";

    // --- Output Info ---
    var grpOutput = win.add("group");
    grpOutput.orientation = "column";
    grpOutput.alignChildren = ["left", "top"];
    grpOutput.spacing = 3;
    grpOutput.add("statictext", undefined, "输出目录：PSD 所在目录下的 export/ 文件夹");
    grpOutput.add("statictext", undefined, "输出格式：PNG-24（保留透明通道）");
    grpOutput.add("statictext", undefined, "命名规则：组名.png / 组名@2x.png");

    // --- Buttons ---
    var grpBtns = win.add("group");
    grpBtns.orientation = "row";
    grpBtns.alignment = "center";
    grpBtns.spacing = 10;

    var btnCancel = grpBtns.add("button", undefined, "取消");
    var btnRun    = grpBtns.add("button", undefined, "开始导出");

    btnCancel.onClick = function () {
        win.close(0);
    };

    btnRun.onClick = function () {
      try {
        var s = txtRegex.text.trim();
        if (s === "") {
            alert("请输入正则表达式！");
            return;
        }
        try {
            new RegExp(s);
        } catch (e) {
            alert("正则表达式无效:\n" + e.message);
            return;
        }
        if (!cbExport1x.value && !cbExport2x.value) {
            alert("请至少选择一种导出倍率（1x 或 2x）！");
            return;
        }
        win.close(1);
      } catch (err) {
        alert("出错:\n" + err.message + "\n(line " + err.line + ")");
      }
    };

    if (win.show() !== 1) return null;

    return {
        regex:    txtRegex.text.trim(),
        export1x: cbExport1x.value,
        export2x: cbExport2x.value
    };
}

// ============================================================================
//                           ACTION MANAGER HELPERS
// ============================================================================

/**
 * 合并当前选中的图层 / 图层组。
 * 对于 LayerSet 会递归合并内部所有子节点到单个栅格图层。
 */
function mergeSelected() {
    var desc = new ActionDescriptor();
    var ref  = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    desc.putReference(charIDToTypeID("null"), ref);
    executeAction(charIDToTypeID("Mrg2"), desc, DialogModes.NO);
}

// ============================================================================
//                           LAYER HELPERS
// ============================================================================

/**
 * 递归查找容器中所有的 LayerSet（包括嵌套组）。
 */
function findAllLayerSets(container) {
    var result = [];
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        if (layer.typename === "LayerSet") {
            result.push(layer);
            var nested = findAllLayerSets(layer);
            result = result.concat(nested);
        }
    }
    return result;
}

// ============================================================================
//                           EXPORT FUNCTIONS
// ============================================================================

/**
 * 将文档导出为 PNG-24。
 */
function exportPNG(doc, filePath) {
    var opts = new ExportOptionsSaveForWeb();
    opts.format       = SaveDocumentType.PNG;
    opts.PNG8         = false;       // PNG-24
    opts.transparency = true;
    opts.interlaced   = false;
    opts.quality      = 100;

    doc.exportDocument(filePath, ExportType.SAVEFORWEB, opts);
}

/**
 * 导出单个图层组。
 *
 * 流程：
 *  1. 选中并复制图层组
 *  2. 合并副本（递归扁平化所有子节点 → 单个栅格图层）
 *  3. 按像素边界选中 → 复制合并 → 粘贴到新文档
 *  4. 裁剪透明边 → 导出 1x / 2x → 清理
 */
function exportGroup(doc, groupLayer, exportDir, export1x, export2x) {
    var groupName = groupLayer.name;
    log("----------------------------------------");
    log("处理图层组: " + groupName);

    // ---- 1. 选中并复制组 ----
    doc.activeLayer = groupLayer;
    var duplicated = groupLayer.duplicate();
    log("  已复制图层组");

    // ---- 2. 合并副本（递归合并所有子节点 → 栅格图层） ----
    doc.activeLayer = duplicated;
    mergeSelected();
    var mergedLayer = doc.activeLayer;
    log("  已合并为栅格图层");

    // ---- 3. 获取边界 ----
    var b = mergedLayer.bounds;  // [left, top, right, bottom]
    var w = Math.ceil(b[2].value - b[0].value);
    var h = Math.ceil(b[3].value - b[1].value);
    log("  图层尺寸: " + w + " × " + h + " px");

    if (w <= 0 || h <= 0) {
        log("  ⚠ 跳过：图层组为空或全部隐藏");
        mergedLayer.remove();
        return;
    }

    // ---- 4. 按像素边界选中并复制合并 ----
    doc.selection.select([
        [b[0].value, b[1].value],
        [b[2].value, b[1].value],
        [b[2].value, b[3].value],
        [b[0].value, b[3].value]
    ]);
    doc.selection.copy(true);  // copy merged

    // ---- 5. 创建临时文档并粘贴 ----
    var tempDoc = app.documents.add(
        w, h, 72,
        groupName,
        NewDocumentMode.RGB,
        DocumentFill.TRANSPARENT
    );
    tempDoc.paste();
    log("  已创建临时文档");

    // ---- 6. 裁剪透明像素 ----
    try {
        tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true);
        log("  裁剪后尺寸: " + Math.ceil(tempDoc.width.value) + " × " + Math.ceil(tempDoc.height.value) + " px");
    } catch (e) {
        log("  ⚠ 裁剪失败（继续导出）: " + e.message);
    }

    // ---- 7. 导出 1x ----
    if (export1x) {
        var path1x = new File(exportDir.fsName + "/" + groupName + ".png");
        exportPNG(tempDoc, path1x);
        log("  ✓ 已导出 1x: " + path1x.fsName);
    }

    // ---- 8. 导出 2x ----
    if (export2x) {
        var tw = tempDoc.width.value;
        var th = tempDoc.height.value;
        try {
            tempDoc.resizeImage(
                UnitValue(Math.ceil(tw * 2), "px"),
                UnitValue(Math.ceil(th * 2), "px"),
                72,
                ResampleMethod.BICUBIC
            );
        } catch (e) {
            // BICUBICSHARPER 在某些版本不存在，回退到 BICUBIC
            tempDoc.resizeImage(
                UnitValue(Math.ceil(tw * 2), "px"),
                UnitValue(Math.ceil(th * 2), "px"),
                72,
                ResampleMethod.BICUBIC
            );
        }
        var path2x = new File(exportDir.fsName + "/" + groupName + "@2x.png");
        exportPNG(tempDoc, path2x);
        log("  ✓ 已导出 2x: " + path2x.fsName);
    }

    // ---- 9. 清理 ----
    tempDoc.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = doc;
    try {
        mergedLayer.remove();
    } catch (e) {
        log("  ⚠ 清理临时图层失败: " + e.message);
    }
    log("  完成: " + groupName);
}

// ============================================================================
//                           MAIN EXPORT FLOW
// ============================================================================

function runExport(export1x, export2x, regexStr) {
    log("");
    log("════════════════════════════════════════");
    log("  开始导出");
    log("  正则: " + regexStr);
    log("  1x: " + (export1x ? "是" : "否") + "  2x: " + (export2x ? "是" : "否"));
    log("════════════════════════════════════════");

    var doc = app.activeDocument;

    // ---- 输出目录 ----
    var psdPath   = doc.fullName;
    var psdDir    = psdPath.parent;
    var exportDir = new Folder(psdDir.fsName + "/export");
    if (!exportDir.exists) {
        exportDir.create();
    }
    log("输出目录: " + exportDir.fsName);

    // ---- 查找所有 LayerSet ----
    var allGroups = findAllLayerSets(doc);
    log("文档中共有 " + allGroups.length + " 个图层组");

    if (allGroups.length === 0) {
        log("⚠ 当前文档中没有图层组（LayerSet），退出。");
        return;
    }

    // ---- 列出所有组名 ----
    log("");
    log("所有图层组名称：");
    for (var j = 0; j < allGroups.length; j++) {
        log("  [" + (j + 1) + "] " + allGroups[j].name);
    }

    // ---- 正则过滤 ----
    var regex = new RegExp(regexStr);
    var matchedGroups = [];
    for (var i = 0; i < allGroups.length; i++) {
        if (regex.test(allGroups[i].name)) {
            matchedGroups.push(allGroups[i]);
        }
    }
    log("");
    log("正则匹配到 " + matchedGroups.length + " 个图层组");
    for (var k = 0; k < matchedGroups.length; k++) {
        log("  ✓ " + matchedGroups[k].name);
    }

    if (matchedGroups.length === 0) {
        log("⚠ 没有匹配的图层组，退出。");
        return;
    }

    // ---- 逐个导出 ----
    log("");
    var successCount = 0;
    var errorCount   = 0;
    for (var m = 0; m < matchedGroups.length; m++) {
        try {
            exportGroup(doc, matchedGroups[m], exportDir, export1x, export2x);
            successCount++;
        } catch (e) {
            errorCount++;
            log("✕ 导出失败 [" + matchedGroups[m].name + "]: " + e.message);
            // 尝试恢复：如果创建了临时文档导致切换，切回原文档
            try {
                app.activeDocument = doc;
            } catch (e2) {}
        }
    }

    // ---- 结果汇总 ----
    log("");
    log("════════════════════════════════════════");
    log("  导出完成!");
    log("  成功: " + successCount + " 个组");
    if (errorCount > 0) {
        log("  失败: " + errorCount + " 个组");
    }
    log("  输出目录: " + exportDir.fsName);
    log("════════════════════════════════════════");
}

// ============================================================================
//                                MAIN
// ============================================================================

function main() {
    if (BridgeTalk.isRunning("photoshop")) {
        // 已在 Photoshop 中运行
    }

    if (app.documents.length === 0) {
        alert("请先打开一个 PSD 文档。");
        return;
    }

    var ui = showDialog();
    if (!ui) {
        return;  // 用户取消
    }

    // ---- 先创建日志窗口（非阻塞，用户能看到） ----
    createLogWindow();

    // ---- 像素级精度 ----
    var originalUnit = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    try {
        runExport(ui.export1x, ui.export2x, ui.regex);
    } catch (e) {
        log("");
        log("════════════════════════════════════════");
        log("✕ 严重错误: " + e.message);
        log("  请将上方日志反馈给开发者");
        log("════════════════════════════════════════");
    } finally {
        app.preferences.rulerUnits = originalUnit;
    }
}

main();
