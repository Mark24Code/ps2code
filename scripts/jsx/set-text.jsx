// 修改文字图层内容。参数: { targetPath, edits:[{psId?, name?, text}] }
//  - psId 优先(PSD 原生 id 精确定位),缺失时按 name 查找第一个匹配图层。
//  - 目标必须是文字图层(kind === LayerKind.TEXT),否则跳过并记日志。
// 依赖 _common.jsxinc(由 Bridge 拼接在前)。
(function () {
    try {
        var p = PS2.params();
        var doc = PS2.openOrReuse(p.targetPath);
        var edits = p.edits || [];

        var report = [];
        for (var i = 0; i < edits.length; i++) {
            var ed = edits[i];
            var label = ed.name || ("#" + ed.psId);
            var layer = PS2.locate(doc, ed);

            if (!layer) {
                PS2._push("SKIP  未找到图层: " + label);
                report.push({ target: label, ok: false, reason: "not_found" });
                continue;
            }
            if (layer.kind !== LayerKind.TEXT) {
                PS2._push("SKIP  非文字图层: " + label);
                report.push({ target: label, ok: false, reason: "not_text" });
                continue;
            }

            var before = "";
            try { before = layer.textItem.contents; } catch (e) {}
            layer.textItem.contents = String(ed.text);
            PS2._push("OK  文字修改: " + label + "  \"" + before + "\" -> \"" + ed.text + "\"");
            report.push({ target: label, ok: true, before: before, after: String(ed.text) });
        }

        doc.save();
        PS2._push("SAVED  " + doc.name);
        return PS2.result(true, { edits: report });
    } catch (e) {
        return PS2.result(false, {}, e.message + (e.line ? " (line " + e.line + ")" : ""));
    }
})();
