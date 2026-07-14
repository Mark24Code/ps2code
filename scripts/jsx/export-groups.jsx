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

        // ---- 目标定位:优先按 psId 精确定位,回退按名 ----
        // p.targets: [{ psId?, name, exportName }]
        var targets = p.targets || [];
        PS2._push("导出目标数: " + targets.length);
        if (targets.length === 0) return PS2.result(true, { files: [], matched: 0, ok: 0, err: 0 });

        // 解析每个 target 为实际图层对象 + 导出基名(exportName 已由 Node 预计算为 叶子名_节点id)。
        var matched = []; // { layer, exportName }
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

        // ---- 文件系统级防覆盖:检查输出目录是否存在同名文件,自动递增序号 ----
        function resolveUniqueName(dir, baseName) {
            var file = new File(dir + '/' + baseName + '.png');
            if (!file.exists) return baseName;
            var seq = 1;
            while (true) {
                var seqStr = String(seq);
                while (seqStr.length < 2) seqStr = "0" + seqStr;
                var candidate = baseName + '_' + seqStr;
                file = new File(dir + '/' + candidate + '.png');
                if (!file.exists) return candidate;
                seq++;
            }
        }

        // ---- Action Manager 辅助:将当前选中图层/组转为智能对象 ----
        // 与 backup/jsx/psd-group-exporter.jsx 完全一致,
        // 递归打包所有子节点并保留混合模式/图层样式。
        function convertToSmartObject() {
            executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
        }

        // ---- 多格式导出(优先 PNG,回退 TIFF→PSD) ----
        // 主方案:与 backup/jsx/psd-group-exporter.jsx 完全一致的 SAVEFORWEB 方式(已验证可用)。
        // 回退方案:TiffSaveOptions + saveAs / PhotoshopSaveOptions + saveAs。
        // 注意:不设 byteOrder/Extension 等枚举,以免旧版 PS 报"无效枚举值"。
        function exportLayerToFile(d, basePath) {
            // 方法1:PNG via SAVEFORWEB (与 backup 完全一致,已验证兼容)
            try {
                var pngFile = new File(basePath + ".png");
                var opts = new ExportOptionsSaveForWeb();
                opts.format       = SaveDocumentType.PNG;
                opts.PNG8         = false;
                opts.transparency = true;
                opts.interlaced   = false;
                opts.quality      = 100;
                d.exportDocument(pngFile, ExportType.SAVEFORWEB, opts);
                PS2._push("  ✓ 1x PNG: " + pngFile.fsName);
                return pngFile;
            } catch (e) {
                PS2._push("  PNG(SAVEFORWEB)不兼容(" + e.message + "),尝试 TIFF…");
            }

            // 方法2:TIFF (中转格式)
            try {
                var tifFile = new File(basePath + ".tif");
                var tifOpt = new TiffSaveOptions();
                tifOpt.transparency = true;
                tifOpt.layers = false;
                d.saveAs(tifFile, tifOpt, true);
                PS2._push("  ✓ 1x TIFF: " + tifFile.fsName);
                return tifFile;
            } catch (e) {
                PS2._push("  TIFF 也不兼容(" + e.message + "),尝试 PSD…");
            }

            // 方法3:PSD (万能保底)
            try {
                var psdFile = new File(basePath + ".psd");
                var psdOpt = new PhotoshopSaveOptions();
                psdOpt.layers = false;
                d.saveAs(psdFile, psdOpt, true);
                PS2._push("  ✓ 1x PSD: " + psdFile.fsName);
                return psdFile;
            } catch (e) {
                throw new Error("所有导出方法均失败: " + e.message);
            }
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
        // 返回:导出成功的文件路径数组
        function exportOneGroup(groupLayer, outName) {
            // 检查文件系统,避免覆盖已有文件
            var uniqueName = resolveUniqueName(exportDir.fsName, outName);
            if (uniqueName !== outName) PS2._push("  文件已存在,重命名为: " + uniqueName);
            var savedFiles = [];
            PS2._push("--- 处理: " + groupLayer.name + (uniqueName !== groupLayer.name ? " → " + uniqueName : ""));

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

            // 7b. 导出 1x(多格式回退:PNG→TIFF→PSD)
            if (p.x1) {
                var f1 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + uniqueName);
                if (f1) savedFiles.push(f1.fsName);
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
                    PS2._push("  BICUBIC 2x 缩放失败(" + e.message + "),改用 BILINEAR…");
                    try {
                        tempDoc.resizeImage(
                            UnitValue(tw * 2, "px"),
                            UnitValue(th * 2, "px"), 72, ResampleMethod.BILINEAR
                        );
                    } catch (e2) {
                        PS2._push("  BILINEAR 也失败,跳过 2x: " + e2.message);
                    }
                }
                var f2 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + uniqueName + "@2x");
                if (f2) savedFiles.push(f2.fsName);
            }

            // 7d. 清理临时文档,切回原文档
            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = doc;
            PS2._push("  ✓ 完成: " + uniqueName);
            return savedFiles;
        }

        // 回退方案:convertToSmartObject 不兼容时,用 mergeVisibleLayers
        // (更保守的合并方式,仅作为兜底,可能丢失部分图层样式)
        function exportOneGroupFallback(groupLayer, outName) {
            // 检查文件系统,避免覆盖已有文件
            var uniqueName = resolveUniqueName(exportDir.fsName, outName);
            if (uniqueName !== outName) PS2._push("  [回退] 文件已存在,重命名为: " + uniqueName);
            var savedFiles = [];
            PS2._push("  [回退] 使用 mergeVisibleLayers 方案");
            doc.activeLayer = groupLayer;
            var duplicated = groupLayer.duplicate();

            var tempDoc = app.documents.add(
                Math.ceil(doc.width.value), Math.ceil(doc.height.value), 72,
                uniqueName, NewDocumentMode.RGB, DocumentFill.TRANSPARENT
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
                var f1 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + uniqueName);
                if (f1) savedFiles.push(f1.fsName);
            }
            if (p.x2) {
                var tw = Math.ceil(tempDoc.width.value), th = Math.ceil(tempDoc.height.value);
                try { tempDoc.resizeImage(UnitValue(tw * 2, "px"), UnitValue(th * 2, "px"), 72, ResampleMethod.BICUBIC); } catch (e) {
                    PS2._push("  [回退] BICUBIC 2x 缩放失败: " + e.message);
                }
                var f2 = exportLayerToFile(tempDoc, exportDir.fsName + "/" + uniqueName + "@2x");
                if (f2) savedFiles.push(f2.fsName);
            }

            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = doc;
            PS2._push("  ✓ [回退] 完成: " + outName);
            return savedFiles;
        }

        // ---- 逐个导出 ----
        var files = [];
        var ok = 0, err = 0;
        for (var m = 0; m < matched.length; m++) {
            try {
                var saved = exportOneGroup(matched[m].layer, matched[m].exportName);
                // 合并该组所有导出的文件路径(1x/2x,PNG/TIFF/PSD)
                if (saved && saved.length > 0) {
                    for (var fi = 0; fi < saved.length; fi++) {
                        files.push(saved[fi]);
                    }
                }
                ok++;
            } catch (e) {
                err++;
                PS2._push("✕ 失败 [" + matched[m].exportName + "]: " + e.message + (e.line ? " (line " + e.line + ")" : ""));
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
