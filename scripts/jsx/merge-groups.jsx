// 合并图层组为单个图层。参数: { targetPath, targets:[{psId?, name?}] }
//  - psId 优先(PSD 原生 id 精确定位),缺失时按 name 查找第一个匹配图层组。
//  - 目标必须是图层组(LayerSet);普通图层无需合并,跳过并记日志。
//  - LayerSet.merge() 会把组内所有图层合并为一个普通图层并返回它。
// 依赖 _common.jsxinc(由 Bridge 拼接在前)。
(function () {
    try {
        var p = PS2.params();
        var doc = PS2.openOrReuse(p.targetPath);
        var targets = p.targets || [];

        var report = [];
        for (var i = 0; i < targets.length; i++) {
            var t = targets[i];
            var label = t.name || ("#" + t.psId);
            var layer = PS2.locate(doc, t);

            if (!layer) {
                PS2._push("SKIP  未找到图层组: " + label);
                report.push({ target: label, ok: false, reason: "not_found" });
                continue;
            }
            if (layer.typename !== "LayerSet") {
                PS2._push("SKIP  非图层组: " + label);
                report.push({ target: label, ok: false, reason: "not_group" });
                continue;
            }

            // merge 需要目标可见,否则会报错;临时置为可见后合并。
            var wasVisible = layer.visible;
            if (!wasVisible) layer.visible = true;
            layer.merge();
            PS2._push("OK  合并图层组: " + label);
            report.push({ target: label, ok: true });
        }

        doc.save();
        PS2._push("SAVED  " + doc.name);
        return PS2.result(true, { merged: report });
    } catch (e) {
        return PS2.result(false, {}, e.message + (e.line ? " (line " + e.line + ")" : ""));
    }
})();
