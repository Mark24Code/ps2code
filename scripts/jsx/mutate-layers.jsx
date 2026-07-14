// 增删改图层。参数: { targetPath, ops:[{action, psId?, name?}] }
// action: hide | show | delete
// 目标定位:
//   - 提供 psId 时,按 PSD 原生 id 精确定位单个图层(任意类型:组或普通图层)。
//   - 否则按 name 匹配所有同名图层(含普通图层 ArtLayer 与图层组 LayerSet)。
// 依赖 _common.jsxinc(由 Bridge 拼接在前)。
(function () {
    try {
        var p = PS2.params();
        var doc = PS2.openOrReuse(p.targetPath);
        var ops = p.ops || [];

        // 递归收集容器内所有匹配 name 的图层(任意类型)。
        function collectByName(container, name, out) {
            for (var i = 0; i < container.layers.length; i++) {
                var l = container.layers[i];
                if (l.name === name) out.push(l);
                if (l.typename === "LayerSet") collectByName(l, name, out);
            }
        }

        var report = [];
        for (var o = 0; o < ops.length; o++) {
            var op = ops[o];
            var action = op.action;
            var fn = null;
            if (action === "hide") fn = function (l) { l.visible = false; };
            else if (action === "show") fn = function (l) { l.visible = true; };
            else if (action === "delete") fn = function (l) { l.remove(); };
            else { PS2._push("SKIP 未知操作: " + action); continue; }

            // 先收集目标(psId 优先,单个;否则按名收集全部),再统一应用,
            // 避免删除时的实时索引错位。
            var matches = [];
            if (typeof op.psId === "number" && op.psId > 0) {
                var one = PS2.selectLayerById(doc, op.psId);
                if (one) matches.push(one);
            } else if (op.name) {
                collectByName(doc, op.name, matches);
            }

            var label = op.name || ("#" + op.psId);
            for (var m = 0; m < matches.length; m++) fn(matches[m]);
            PS2._push((matches.length > 0 ? "OK  " : "SKIP  ") + action + " " + label + " (" + matches.length + " 处)");
            report.push({ action: action, target: label, count: matches.length });
        }

        doc.save();
        PS2._push("SAVED  " + doc.name);
        return PS2.result(true, { ops: report });
    } catch (e) {
        return PS2.result(false, {}, e.message + (e.line ? " (line " + e.line + ")" : ""));
    }
})();
