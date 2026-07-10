// 批量重命名图层组。参数: { targetPath, rules:[{from,to}] }
// 依赖 _common.jsxinc(由 Bridge 拼接在前)。
(function () {
    try {
        var p = PS2.params();
        var doc = PS2.openOrReuse(p.targetPath);
        var rules = p.rules || [];

        function renameIn(container, rule, counter) {
            for (var i = 0; i < container.layerSets.length; i++) {
                var g = container.layerSets[i];
                if (g.name === rule.from) {
                    g.name = rule.to;
                    counter.n++;
                }
                renameIn(g, rule, counter);
            }
        }

        var report = [];
        for (var r = 0; r < rules.length; r++) {
            var counter = { n: 0 };
            renameIn(doc, rules[r], counter);
            if (counter.n > 0) {
                PS2._push("OK  " + rules[r].from + " -> " + rules[r].to + " (" + counter.n + " 处)");
            } else {
                PS2._push("SKIP  未找到组: " + rules[r].from);
            }
            report.push({ from: rules[r].from, to: rules[r].to, count: counter.n });
        }

        doc.save();
        PS2._push("SAVED  " + doc.name);
        return PS2.result(true, { rules: report });
    } catch (e) {
        return PS2.result(false, {}, e.message + (e.line ? " (line " + e.line + ")" : ""));
    }
})();
