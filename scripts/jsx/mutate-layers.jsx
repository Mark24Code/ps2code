// 增删改图层。参数: { targetPath, ops:[{action, name}] }
// action: hide | show | delete
// 依赖 _common.jsxinc(由 Bridge 拼接在前)。
(function () {
    try {
        var p = PS2.params();
        var doc = PS2.openOrReuse(p.targetPath);
        var ops = p.ops || [];

        // 递归应用到所有同名 LayerSet
        function applyToSets(container, name, fn, counter) {
            for (var i = container.layerSets.length - 1; i >= 0; i--) {
                var g = container.layerSets[i];
                // 先递归子级(删除时从后往前避免索引错位)
                applyToSets(g, name, fn, counter);
                if (g.name === name) {
                    fn(g);
                    counter.n++;
                }
            }
        }

        var report = [];
        for (var o = 0; o < ops.length; o++) {
            var op = ops[o];
            var counter = { n: 0 };
            var action = op.action;
            var fn = null;
            if (action === "hide") fn = function (g) { g.visible = false; };
            else if (action === "show") fn = function (g) { g.visible = true; };
            else if (action === "delete") fn = function (g) { g.remove(); };
            else { PS2._push("SKIP 未知操作: " + action); continue; }

            applyToSets(doc, op.name, fn, counter);
            PS2._push((counter.n > 0 ? "OK  " : "SKIP  ") + action + " " + op.name + " (" + counter.n + " 处)");
            report.push({ action: action, name: op.name, count: counter.n });
        }

        doc.save();
        PS2._push("SAVED  " + doc.name);
        return PS2.result(true, { ops: report });
    } catch (e) {
        return PS2.result(false, {}, e.message + (e.line ? " (line " + e.line + ")" : ""));
    }
})();
