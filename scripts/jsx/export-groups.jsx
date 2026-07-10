// 导出匹配的图层组为 PNG。移植自 backup/jsx/psd-group-exporter.jsx 的导出逻辑(去 UI)。
// 参数: { targetPath, pattern, names:[], x1, x2, trim, outputDir }
//   pattern: 正则字符串(匹配组名);names: 明确的组名列表(与 pattern 二选一或并用)
// 依赖 _common.jsxinc(由 Bridge 拼接在前)。
(function () {
    var originalUnit = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    try {
        var p = PS2.params();
        var doc = PS2.openOrReuse(p.targetPath);

        var exportDir = new Folder(p.outputDir);
        if (!exportDir.exists) exportDir.create();

        var allGroups = PS2.findAllLayerSets(doc);
        PS2._push("文档共 " + allGroups.length + " 个图层组");

        // 过滤
        var matched = [];
        var useRegex = p.pattern && p.pattern.length > 0;
        var nameSet = {};
        if (p.names && p.names.length) {
            for (var ni = 0; ni < p.names.length; ni++) nameSet[p.names[ni]] = true;
        }
        var regex = useRegex ? new RegExp(p.pattern) : null;
        for (var i = 0; i < allGroups.length; i++) {
            var nm = allGroups[i].name;
            var hit = false;
            if (regex && regex.test(nm)) hit = true;
            if (nameSet[nm]) hit = true;
            if (hit) matched.push(allGroups[i]);
        }
        PS2._push("匹配到 " + matched.length + " 个图层组");
        if (matched.length === 0) return PS2.result(true, { files: [], matched: 0 });

        // 重名统计 → 追加补零序号
        var nameTotal = {};
        for (var t = 0; t < matched.length; t++) {
            var mn = matched[t].name;
            nameTotal[mn] = (nameTotal[mn] || 0) + 1;
        }
        var nameSeq = {};
        function makeExportName(name) {
            if (nameTotal[name] <= 1) return name;
            nameSeq[name] = (nameSeq[name] || 0) + 1;
            var width = String(nameTotal[name]).length; if (width < 2) width = 2;
            var s = String(nameSeq[name]);
            while (s.length < width) s = "0" + s;
            return name + s;
        }

        function exportPNG(d, filePath) {
            var opts = new ExportOptionsSaveForWeb();
            opts.format = SaveDocumentType.PNG;
            opts.PNG8 = false;
            opts.transparency = true;
            opts.interlaced = false;
            opts.quality = 100;
            d.exportDocument(filePath, ExportType.SAVEFORWEB, opts);
        }

        function convertToSmartObject() {
            executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
        }

        var files = [];
        function exportGroup(groupLayer, outName) {
            doc.activeLayer = groupLayer;
            var duplicated = groupLayer.duplicate();
            doc.activeLayer = duplicated;
            convertToSmartObject();
            var mergedLayer = doc.activeLayer;

            var b = mergedLayer.bounds;
            var w = Math.ceil(b[2].value - b[0].value);
            var h = Math.ceil(b[3].value - b[1].value);
            if (w <= 0 || h <= 0) { mergedLayer.remove(); PS2._push("跳过空组: " + outName); return; }

            var tempDoc = app.documents.add(
                Math.ceil(doc.width.value), Math.ceil(doc.height.value), 72,
                outName, NewDocumentMode.RGB, DocumentFill.TRANSPARENT
            );
            app.activeDocument = doc;
            mergedLayer.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);
            try { mergedLayer.remove(); } catch (e) {}

            app.activeDocument = tempDoc;
            if (p.trim) {
                try { tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true); } catch (e) {}
            }

            if (p.x1) {
                var path1x = new File(exportDir.fsName + "/" + outName + ".png");
                exportPNG(tempDoc, path1x);
                files.push(path1x.fsName);
                PS2._push("1x: " + path1x.fsName);
            }
            if (p.x2) {
                var tw = tempDoc.width.value, th = tempDoc.height.value;
                tempDoc.resizeImage(
                    UnitValue(Math.ceil(tw * 2), "px"),
                    UnitValue(Math.ceil(th * 2), "px"), 72, ResampleMethod.BICUBIC
                );
                var path2x = new File(exportDir.fsName + "/" + outName + "@2x.png");
                exportPNG(tempDoc, path2x);
                files.push(path2x.fsName);
                PS2._push("2x: " + path2x.fsName);
            }
            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = doc;
        }

        var ok = 0, err = 0;
        for (var m = 0; m < matched.length; m++) {
            try { exportGroup(matched[m], makeExportName(matched[m].name)); ok++; }
            catch (e) { err++; PS2._push("失败 [" + matched[m].name + "]: " + e.message); try { app.activeDocument = doc; } catch (e2) {} }
        }

        return PS2.result(true, { files: files, matched: matched.length, ok: ok, err: err, outputDir: exportDir.fsName });
    } catch (e) {
        return PS2.result(false, {}, e.message + (e.line ? " (line " + e.line + ")" : ""));
    } finally {
        app.preferences.rulerUnits = originalUnit;
    }
})();
