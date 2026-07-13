// 导出 "组 84" 图层组为 PNG —— 通过 osascript 调用
// 参数: 无 (硬编码目标路径与图层名)
(function () {
    var TARGET_GROUP_NAME = "组 84";
    var PSD_PATH = "/Users/bilibili/Workspace/ps2code/design-drafts/a签到.psd";

    var originalUnit = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    try {
        // ---- 1. 打开文档 ----
        var psdFile = new File(PSD_PATH);
        if (!psdFile.exists) throw new Error("PSD 文件不存在: " + PSD_PATH);

        var doc = app.open(psdFile);
        app.activeDocument = doc;

        // ---- 2. 递归查找目标图层组 ----
        function findLayerSet(container, name) {
            for (var i = 0; i < container.layers.length; i++) {
                var layer = container.layers[i];
                if (layer.typename === "LayerSet" && layer.name === name) return layer;
                if (layer.typename === "LayerSet") {
                    var found = findLayerSet(layer, name);
                    if (found) return found;
                }
            }
            return null;
        }

        var groupLayer = findLayerSet(doc, TARGET_GROUP_NAME);
        if (!groupLayer) throw new Error("未找到图层组: " + TARGET_GROUP_NAME);

        // ---- 3. 复制图层组并转为智能对象 ----
        doc.activeLayer = groupLayer;
        var duplicated = groupLayer.duplicate();
        doc.activeLayer = duplicated;
        executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
        var smartLayer = doc.activeLayer;

        // ---- 4. 创建临时文档,放入智能对象 ----
        var bounds = smartLayer.bounds;
        var layerW = Math.ceil(bounds[2].value - bounds[0].value);
        var layerH = Math.ceil(bounds[3].value - bounds[1].value);
        if (layerW <= 0 || layerH <= 0) throw new Error("图层组为空或全部隐藏");

        var tempDoc = app.documents.add(
            Math.ceil(doc.width.value), Math.ceil(doc.height.value), 72,
            "temp_" + TARGET_GROUP_NAME, NewDocumentMode.RGB, DocumentFill.TRANSPARENT
        );

        app.activeDocument = doc;
        smartLayer.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);
        try { smartLayer.remove(); } catch (e) {}

        app.activeDocument = tempDoc;

        // ---- 5. 裁剪透明像素 ----
        try { tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true); } catch (e) {}

        // ---- 6. 导出 PNG（保存到当前工作目录） ----
        var outputFile = new File(Folder.current.fsName + "/" + TARGET_GROUP_NAME + ".png");
        var opts = new ExportOptionsSaveForWeb();
        opts.format = SaveDocumentType.PNG;
        opts.PNG8 = false;
        opts.transparency = true;
        opts.interlaced = false;
        opts.quality = 100;
        tempDoc.exportDocument(outputFile, ExportType.SAVEFORWEB, opts);

        // ---- 7. 清理 ----
        tempDoc.close(SaveOptions.DONOTSAVECHANGES);
        doc.close(SaveOptions.DONOTSAVECHANGES);

    } catch (e) {
        alert("导出失败:\n" + e.message + (e.line ? " (行 " + e.line + ")" : ""));
    } finally {
        app.preferences.rulerUnits = originalUnit;
    }
})();
