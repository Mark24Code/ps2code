// 确保目标设计稿在 PS 中打开并置为当前文档。参数: { targetPath }
// 依赖 _common.jsxinc(由 Bridge 拼接在前)。
(function () {
    try {
        var p = PS2.params();
        var doc = PS2.openOrReuse(p.targetPath);
        PS2._push("当前文档: " + doc.name);
        return PS2.result(true, { docName: doc.name, version: app.version });
    } catch (e) {
        return PS2.result(false, {}, e.message + (e.line ? " (line " + e.line + ")" : ""));
    }
})();
