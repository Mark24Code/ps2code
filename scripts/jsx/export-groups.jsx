// 导出匹配的图层组为 PNG —— 移植自 backup/jsx/psd-group-exporter.jsx 的导出逻辑(去 UI)。
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
        PS2._push("输出目录: " + exportDir.fsName);

        var allGroups = PS2.findAllLayerSets(doc);
        PS2._push("文档共 " + allGroups.length + " 个图层组");

        // ---- 过滤 ----
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
        if (matched.length === 0) return PS2.result(true, { files: [], matched: 0, ok: 0, err: 0 });

        // ---- 重名统计 → 追加补零序号 ----
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
            return name + "_" + s;
        }

        // ---- Action Manager 辅助:将当前选中图层/组转为智能对象 ----
        // 与 backup/jsx/psd-group-exporter.jsx 完全一致,
        // 递归打包所有子节点并保留混合模式/图层样式。
        function convertToSmartObject() {
            executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
        }

        // ---- 导出 PNG-24 ----
        function exportPNG(d, filePath) {
            var opts = new ExportOptionsSaveForWeb();
            opts.format = SaveDocumentType.PNG;
            opts.PNG8 = false;
            opts.transparency = true;
            opts.interlaced = false;
            opts.quality = 100;
            d.exportDocument(filePath, ExportType.SAVEFORWEB, opts);
        }

        // ---- 导出单个图层组(移植自 backup exportGroup) ----
        // 流程:
        //  1. duplicate 图层组副本
        //  2. convertToSmartObject 转为智能对象(保留混合模式/图层样式)
        //  3. 校验非空
        //  4. 创建与原始文档同尺寸的透明临时文档
        //  5. 将智能对象 duplicate 到临时文档
        //  6. 删除原始文档里的副本,还原原始文档
        //  7. 裁剪透明边 → 导出 1x/2x → 关闭临时文档
        function exportOneGroup(groupLayer, outName) {
            PS2._push("--- 处理: " + groupLayer.name + (outName !== groupLayer.name ? " → " + outName : ""));

            // 1. 复制组副本
            doc.activeLayer = groupLayer;
            var duplicated = groupLayer.duplicate();
            PS2._push("  已复制图层组");

            // 2. 转为智能对象
            doc.activeLayer = duplicated;
            try {
                convertToSmartObject();
            } catch (e) {
                PS2._push("  convertToSmartObject 失败: " + e.message + " → 尝试回退方案");
                // 回退:直接删掉副本,走 mergeVisibleLayers 方案
                duplicated.remove();
                return exportOneGroupFallback(groupLayer, outName);
            }
            var mergedLayer = doc.activeLayer;
            PS2._push("  已转为智能对象");

            // 3. 获取边界,校验非空
            var b = mergedLayer.bounds;
            var w = Math.ceil(b[2].value - b[0].value);
            var h = Math.ceil(b[3].value - b[1].value);
            PS2._push("  图层尺寸: " + w + " × " + h + " px");
            if (w <= 0 || h <= 0) {
                PS2._push("  跳过:图层组为空或全部隐藏");
                mergedLayer.remove();
                return;
            }

            // 4. 创建与原文档等尺寸的临时文档
            var tempDoc = app.documents.add(
                Math.ceil(doc.width.value), Math.ceil(doc.height.value), 72,
                outName, NewDocumentMode.RGB, DocumentFill.TRANSPARENT
            );

            // 5. 将智能对象复制到临时文档
            app.activeDocument = doc;
            mergedLayer.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);
            PS2._push("  已复制到临时文档");

            // 6. 还原原文档:删除智能对象副本
            try { mergedLayer.remove(); } catch (e) {
                PS2._push("  移除副本失败(继续): " + e.message);
            }

            // 切换到临时文档
            app.activeDocument = tempDoc;

            // 7a. 裁剪透明像素
            if (p.trim) {
                try {
                    tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true);
                    PS2._push("  裁剪后: " + Math.ceil(tempDoc.width.value) + " × " + Math.ceil(tempDoc.height.value) + " px");
                } catch (e) {
                    PS2._push("  裁剪失败(继续导出): " + e.message);
                }
            }

            // 7b. 导出 1x
            if (p.x1) {
                var path1x = new File(exportDir.fsName + "/" + outName + ".png");
                exportPNG(tempDoc, path1x);
                PS2._push("  ✓ 1x: " + path1x.fsName);
            }

            // 7c. 导出 2x
            if (p.x2) {
                var tw = Math.ceil(tempDoc.width.value);
                var th = Math.ceil(tempDoc.height.value);
                try {
                    tempDoc.resizeImage(
                        UnitValue(tw * 2, "px"),
                        UnitValue(th * 2, "px"), 72, ResampleMethod.BICUBIC
                    );
                } catch (e) {
                    tempDoc.resizeImage(
                        UnitValue(tw * 2, "px"),
                        UnitValue(th * 2, "px"), 72, ResampleMethod.BICUBIC
                    );
                }
                var path2x = new File(exportDir.fsName + "/" + outName + "@2x.png");
                exportPNG(tempDoc, path2x);
                PS2._push("  ✓ 2x: " + path2x.fsName);
            }

            // 7d. 清理临时文档,切回原文档
            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = doc;
            PS2._push("  ✓ 完成: " + outName);
        }

        // 回退方案:convertToSmartObject 不兼容时,用 mergeVisibleLayers
        // (更保守的合并方式,仅作为兜底,可能丢失部分图层样式)
        function exportOneGroupFallback(groupLayer, outName) {
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
            // 确保所有子层可见后合并
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

            if (p.trim) {
                try { tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true); } catch (e) {}
            }

            if (p.x1) {
                var path1x = new File(exportDir.fsName + "/" + outName + ".png");
                exportPNG(tempDoc, path1x);
                PS2._push("  ✓ 1x: " + path1x.fsName);
            }
            if (p.x2) {
                var tw = Math.ceil(tempDoc.width.value), th = Math.ceil(tempDoc.height.value);
                try { tempDoc.resizeImage(UnitValue(tw * 2, "px"), UnitValue(th * 2, "px"), 72, ResampleMethod.BICUBIC); } catch (e) {}
                var path2x = new File(exportDir.fsName + "/" + outName + "@2x.png");
                exportPNG(tempDoc, path2x);
                PS2._push("  ✓ 2x: " + path2x.fsName);
            }

            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = doc;
            PS2._push("  ✓ [回退] 完成: " + outName);
        }

        // ---- 逐个导出 ----
        var files = [];
        var ok = 0, err = 0;
        for (var m = 0; m < matched.length; m++) {
            try {
                var outName = makeExportName(matched[m].name);
                exportOneGroup(matched[m], outName);
                files.push(exportDir.fsName + "/" + outName + ".png");
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
