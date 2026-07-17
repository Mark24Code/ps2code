// 按用户的选区导出目标图层为 PNG。
// 流程:
//  1. 获取用户当前激活的选区(矩形选框/套索等均可)的边界
//  2. 新建与原始文档等尺寸的临时透明文档
//  3. 将目标图层复制到临时文档(转为智能对象)
//  4. 在临时文档中按选区边界裁剪画布
//  5. 导出为 PNG(1x/2x)
// 参数: { targetPath, targets:[{psId?,name,exportName}], outputDir, x1, x2, trim }
// 依赖 _common.jsxinc(由 Bridge 拼接在前)。
(function () {
    var originalUnit = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    try {
        var p = PS2.params();
        var doc = PS2.openOrReuse(p.targetPath);

        // ---- 0. 检查选区 ----
        if (doc.selection === null || doc.selection === undefined) {
            return PS2.result(false, {}, "当前文档没有激活的选区。请先在 Photoshop 中用选区工具框选要导出的区域,再切换回此应用调用导出。");
        }

        // ---- 1. 获取选区边界 ----
        var selBounds = doc.selection.bounds;
        var selL = selBounds[0].value;
        var selT = selBounds[1].value;
        var selR = selBounds[2].value;
        var selB = selBounds[3].value;
        var selW = Math.ceil(selR - selL);
        var selH = Math.ceil(selB - selT);
        PS2._push("选区范围: " + Math.round(selL) + "," + Math.round(selT) + " → " + Math.round(selR) + "," + Math.round(selB));
        PS2._push("选区尺寸: " + selW + " × " + selH + " px");
        if (selW <= 0 || selH <= 0) {
            return PS2.result(false, {}, "选区宽度或高度为 0,无法导出。");
        }

        // ---- 2. 准备输出目录 ----
        var exportDir = new Folder(p.outputDir);
        if (!exportDir.exists) exportDir.create();
        PS2._push("输出目录: " + exportDir.fsName);

        // ---- 3. 解析目标图层 ----
        var targets = p.targets || [];
        PS2._push("导出目标数: " + targets.length);
        if (targets.length === 0) return PS2.result(true, { files: [], matched: 0, ok: 0, err: 0 });

        var matched = [];
        for (var ti = 0; ti < targets.length; ti++) {
            var t = targets[ti];
            var layer = null;
            if (typeof t.psId === "number" && t.psId > 0) {
                layer = PS2.selectLayerById(doc, t.psId);
                if (!layer) PS2._push("  按 id " + t.psId + " 未定位到,回退按名 '" + t.name + "'");
            }
            if (!layer) layer = PS2.findAnyByName(doc, t.name);
            if (!layer) {
                PS2._push("✕ 未找到目标: " + t.name + " (id=" + t.psId + ")");
                continue;
            }
            matched.push({ layer: layer, exportName: t.exportName });
        }
        PS2._push("定位到 " + matched.length + " 个图层");
        if (matched.length === 0) return PS2.result(true, { files: [], matched: 0, ok: 0, err: 0 });

        // ---- 4. 文件系统防覆盖 ----
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

        // ---- 5. 辅助函数:智能对象转换(打包组内所有子节点,保留混合模式/图层样式) ----
        function convertToSmartObject() {
            executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
        }

        // ---- 6. 导出单文件(多格式回退:PNG→TIFF→PSD) ----
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
                PS2._push("  PNG(SAVEFORWEB) 失败(" + e.message + "),尝试 TIFF…");
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
                PS2._push("  TIFF 也失败(" + e.message + "),尝试 PSD…");
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

        // ---- 7. 导出单个图层(等尺寸临时文档 + 裁剪到选区) ----
        function exportOne(layerObj, outName) {
            var uniqueName = resolveUniqueName(exportDir.fsName, outName);
            if (uniqueName !== outName) PS2._push("  文件已存在,重命名为: " + uniqueName);
            var savedFiles = [];
            PS2._push("--- 处理: " + layerObj.name + " → " + uniqueName);

            // 7a. 复制图层
            doc.activeLayer = layerObj;
            var duplicated = layerObj.duplicate();
            PS2._push("  已复制图层");

            // 7b. 转为智能对象(保留混合模式/图层样式,打包所有子节点)
            doc.activeLayer = duplicated;
            try {
                convertToSmartObject();
            } catch (e) {
                PS2._push("  convertToSmartObject 失败(" + e.message + "),尝试回退方案");
                duplicated.remove();
                return exportOneFallback(layerObj, outName);
            }
            var mergedLayer = doc.activeLayer;
            PS2._push("  已转为智能对象");

            // 7c. 校验非空
            var b = mergedLayer.bounds;
            var bw = Math.ceil(b[2].value - b[0].value);
            var bh = Math.ceil(b[3].value - b[1].value);
            PS2._push("  图层原始尺寸: " + bw + " × " + bh + " px");
            if (bw <= 0 || bh <= 0) {
                PS2._push("  跳过:图层为空或全部隐藏");
                mergedLayer.remove();
                return null;
            }

            // 7d. 创建与原始文档等尺寸的临时透明文档(关键:等尺寸确保图层位置不变)
            var tempDoc = app.documents.add(
                Math.ceil(doc.width.value), Math.ceil(doc.height.value), 72,
                "_tmp_" + uniqueName, NewDocumentMode.RGB, DocumentFill.TRANSPARENT
            );

            // 7e. 将智能对象复制到临时文档(等尺寸画布,图层坐标自动匹配)
            app.activeDocument = doc;
            mergedLayer.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);
            PS2._push("  已复制到临时文档");
            try { mergedLayer.remove(); } catch (e2) {
                PS2._push("  移除副本失败(继续): " + e2.message);
            }

            // 7f. 切换到临时文档,按选区裁剪画布
            app.activeDocument = tempDoc;
            try {
                var cropRegion = [
                    UnitValue(selL, "px"),
                    UnitValue(selT, "px"),
                    UnitValue(selR, "px"),
                    UnitValue(selB, "px")
                ];
                tempDoc.crop(cropRegion);
                PS2._push("  裁剪到选区: " + Math.ceil(tempDoc.width.value) + " × " + Math.ceil(tempDoc.height.value) + " px");
            } catch (e3) {
                PS2._push("  选区裁剪失败(继续导出): " + e3.message);
                // 裁剪失败时尝试备用方案:缩小画布到选区尺寸
                try {
                    tempDoc.resizeCanvas(selW, selH, AnchorPosition.TOPLEFT);
                    PS2._push("  备用:缩小画布到 " + selW + " × " + selH);
                } catch (e3b) {
                    PS2._push("  备用缩小画布也失败(继续导出): " + e3b.message);
                }
            }

            // 7g. 注意:不执行透明边裁剪,保持选区尺寸输出
            // 选区导出 = 按用户框选范围输出,周边空白应保留。
            // 如需去除图层周围空白,应先在 PS 中调整选区边界再导出。

            // 7h. 导出 1x
            if (p.x1) {
                var f1 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + uniqueName);
                if (f1) savedFiles.push(f1.fsName);
            }

            // 7i. 导出 2x
            if (p.x2) {
                var tw = Math.ceil(tempDoc.width.value);
                var th = Math.ceil(tempDoc.height.value);
                try {
                    tempDoc.resizeImage(
                        UnitValue(tw * 2, "px"),
                        UnitValue(th * 2, "px"), 72, ResampleMethod.BICUBIC
                    );
                } catch (e5) {
                    PS2._push("  BICUBIC 2x 缩放失败(" + e5.message + "),尝试 BILINEAR…");
                    try {
                        tempDoc.resizeImage(
                            UnitValue(tw * 2, "px"),
                            UnitValue(th * 2, "px"), 72, ResampleMethod.BILINEAR
                        );
                    } catch (e6) {
                        PS2._push("  BILINEAR 也失败,跳过 2x: " + e6.message);
                    }
                }
                var f2 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + uniqueName + "@2x");
                if (f2) savedFiles.push(f2.fsName);
            }

            // 7j. 清理临时文档,切回原文档
            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = doc;
            PS2._push("  ✓ 完成: " + uniqueName);
            return savedFiles;
        }

        // ---- 8. 回退方案:mergeVisibleLayers(smart object 不兼容时的兜底) ----
        function exportOneFallback(layerObj, outName) {
            var uniqueName = resolveUniqueName(exportDir.fsName, outName);
            var savedFiles = [];
            PS2._push("  [回退] 使用 mergeVisibleLayers 方案");
            doc.activeLayer = layerObj;
            var duplicated = layerObj.duplicate();

            // 等尺寸临时文档
            var tempDoc = app.documents.add(
                Math.ceil(doc.width.value), Math.ceil(doc.height.value), 72,
                "_tmp_" + uniqueName, NewDocumentMode.RGB, DocumentFill.TRANSPARENT
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
                if (tempDoc.layers.length === 1 && tempDoc.layers[0].typename === "LayerSet") {
                    try { tempDoc.layers[0].merge(); } catch (e2) {
                        PS2._push("  [回退] LayerSet.merge 也失败: " + e2.message);
                    }
                }
            }

            // 裁剪到选区
            try {
                var cropRegion = [
                    UnitValue(selL, "px"),
                    UnitValue(selT, "px"),
                    UnitValue(selR, "px"),
                    UnitValue(selB, "px")
                ];
                tempDoc.crop(cropRegion);
                PS2._push("  [回退] 裁剪到选区: " + Math.ceil(tempDoc.width.value) + " × " + Math.ceil(tempDoc.height.value) + " px");
            } catch (e) {
                PS2._push("  [回退] 选区裁剪失败(继续): " + e.message);
            }

            // 不执行透明边裁剪,保持选区尺寸

            if (p.x1) {
                var f1 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + uniqueName);
                if (f1) savedFiles.push(f1.fsName);
            }
            if (p.x2) {
                var tw = Math.ceil(tempDoc.width.value), th = Math.ceil(tempDoc.height.value);
                try { tempDoc.resizeImage(UnitValue(tw * 2, "px"), UnitValue(th * 2, "px"), 72, ResampleMethod.BICUBIC); } catch (e) {
                    try { tempDoc.resizeImage(UnitValue(tw * 2, "px"), UnitValue(th * 2, "px"), 72, ResampleMethod.BILINEAR); } catch (e2) {}
                }
                var f2 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + uniqueName + "@2x");
                if (f2) savedFiles.push(f2.fsName);
            }

            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = doc;
            PS2._push("  ✓ [回退] 完成: " + uniqueName);
            return savedFiles;
        }

        // ---- 9. 逐个导出 ----
        var files = [];
        var ok = 0, err = 0;
        for (var mi = 0; mi < matched.length; mi++) {
            try {
                var saved = exportOne(matched[mi].layer, matched[mi].exportName);
                if (saved && saved.length > 0) {
                    for (var fi = 0; fi < saved.length; fi++) files.push(saved[fi]);
                    ok++;
                } else {
                    err++;
                }
            } catch (e) {
                err++;
                PS2._push("✕ 失败 [" + matched[mi].exportName + "]: " + e.message + (e.line ? " (line " + e.line + ")" : ""));
                try { app.activeDocument = doc; } catch (e2) {}
            }
        }

        PS2._push("══════════════════════");
        PS2._push("选区导出完成! 成功: " + ok + "  失败: " + err);
        return PS2.result(true, { files: files, matched: matched.length, ok: ok, err: err, outputDir: exportDir.fsName });

    } catch (e) {
        return PS2.result(false, {}, e.message + (e.line ? " (line " + e.line + ")" : ""));
    } finally {
        app.preferences.rulerUnits = originalUnit;
    }
})();
