#target photoshop

/**
 * Convert Effects to Smart Object - Photoshop Script
 * 
 * 功能：
 * 1. 自动将所有带有"图层样式(Effects/FX)"的图层（包括组和普通图层）转换为智能对象。
 * 2. 自动将所有带有"链接蒙版"(图层蒙版或矢量蒙版)的图层转换为智能对象。
 * 3. 确保所有需要Photoshop自身渲染能力的元素都被"烘焙"进智能对象，以便第三方工具导出。
 * 
 * 作者: Antigravity Agent
 */

// ============================================================================
//                                     UI
// ============================================================================

function showDialog() {
    var win = new Window("dialog", "Convert Effects to Smart Objects");
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 15;
    win.margins = 20;

    // --- Header ---
    var pnlHeader = win.add("panel", undefined, undefined);
    pnlHeader.alignment = "fill";
    var lblTitle = pnlHeader.add("statictext", undefined, "图片预处理工具");
    lblTitle.alignment = "center";
    lblTitle.graphics.font = ScriptUI.newFont(lblTitle.graphics.font.name, "BOLD", 16);

    // --- Description ---
    var grpDesc = win.add("group");
    grpDesc.orientation = "column";
    grpDesc.alignChildren = ["left", "top"];
    grpDesc.add("statictext", undefined, "此脚本将扫描文档并将以下元素转换为智能对象：");

    var list = grpDesc.add("group");
    list.orientation = "column";
    list.alignChildren = ["left", "top"];
    list.margins = [10, 0, 0, 0];
    list.add("statictext", undefined, "• 任何带有图层样式 (Effects/FX) 的图层或组");
    list.add("statictext", undefined, "• 任何带有链接蒙版 (Linked Mask) 的图层");
    list.add("statictext", undefined, "• 任何带有链接矢量蒙版的图层");

    grpDesc.add("statictext", undefined, "确保导出时保留完整渲染效果。", { multiline: true });

    // --- Options ---
    var pnlOpts = win.add("panel", undefined, "选项");
    pnlOpts.orientation = "column";
    pnlOpts.alignChildren = ["left", "top"];

    var cbProcessGroups = pnlOpts.add("checkbox", undefined, "处理带特效的图层组 (推荐)");
    cbProcessGroups.value = false;
    cbProcessGroups.helpTip = "如果勾选，带特效的组将整体转为智能对象。如果不勾选，只处理组内的图层。";

    // --- Buttons ---
    var grpBtns = win.add("group");
    grpBtns.orientation = "row";
    grpBtns.alignment = "center";

    var btnCancel = grpBtns.add("button", undefined, "取消");
    var btnRun = grpBtns.add("button", undefined, "开始处理");

    btnCancel.onClick = function () {
        win.close(0);
    };

    btnRun.onClick = function () {
        win.close(1);
    };

    return {
        result: win.show(),
        processGroups: cbProcessGroups.value
    };
}

// ============================================================================
//                                   LOGIC
// ============================================================================

// 全局统计
var stats = {
    totalChecked: 0,
    convertedEffects: 0,
    convertedMasks: 0,
    convertedGroups: 0
};

var MAX_ITERATIONS = 20; // 防止无限循环的安全限制
var hasConvertedThisRound = false;

function main() {
    if (app.documents.length === 0) {
        alert("请先打开一个 PSD 文档。");
        return;
    }

    var ui = showDialog();
    if (ui.result !== 1) return;

    var doc = app.activeDocument;

    // 挂起历史记录，提高性能
    doc.suspendHistory("Convert Effects to Smart Objects", "runProcess(doc, ui.processGroups)");
}

function runProcess(doc, processGroups) {
    var round = 0;
    var keepGoing = true;

    while (keepGoing && round < MAX_ITERATIONS) {
        round++;
        hasConvertedThisRound = false;

        // 每次循环重新获取图层结构，因为结构变了
        // 我们使用递归函数遍历
        processLayerSet(doc, processGroups);

        if (!hasConvertedThisRound) {
            keepGoing = false; // 如果这一轮没有做任何事情，就说明处理完了
        }
    }

    // Result
    var msg = "处理完成!\n\n" +
        "循环次数: " + round + "\n" +
        "因特效转换: " + stats.convertedEffects + "\n" +
        "因蒙版转换: " + stats.convertedMasks + "\n" +
        "图层组转换: " + stats.convertedGroups;
    alert(msg);
}

/**
 * 递归处理图层集合
 */
function processLayerSet(container, processGroups) {
    // 倒序遍历，防止索引因转换而改变导致的问题
    for (var i = container.layers.length - 1; i >= 0; i--) {
        var layer = container.layers[i];

        // 跳过锁定的背景层
        if (layer.isBackgroundLayer || layer.allLocked) continue;

        // 检查是否已经是智能对象，如果是，跳过
        if (layer.kind == LayerKind.SMARTOBJECT) continue;

        var converted = false;

        // 1. 检查图层组
        if (layer.typename == "LayerSet") {
            // 如果允许处理组，并且组有特效
            if (processGroups && hasEffects(layer)) {
                // 将组转换为智能对象
                convertLayerToSmartObject(layer);
                stats.convertedGroups++;
                converted = true;
            } else {
                // 否则递归进入组
                processLayerSet(layer, processGroups);
            }
        }
        // 2. 普通图层
        else {
            if (shouldConvert(layer)) {
                convertLayerToSmartObject(layer);
                converted = true;
            }
        }

        if (converted) {
            hasConvertedThisRound = true;
        }
    }
}

/**
 * 判断单个图层是否需要转换
 */
function shouldConvert(layer) {
    // 检查特效
    if (hasEffects(layer)) {
        stats.convertedEffects++;
        return true;
    }

    // 检查链接的所有者蒙版 (User Mask) 或 矢量蒙版 (Vector Mask)
    if (hasLinkedMask(layer)) {
        stats.convertedMasks++;
        return true;
    }

    return false;
}

/**
 * 将当前图层对象转换为智能对象
 * 注意：需要在转换前选中该图层
 * 更新：转换后恢复混合模式和不透明度，以保持视觉一致性
 */
function convertLayerToSmartObject(layer) {
    app.activeDocument.activeLayer = layer;

    // 1. 保存原始属性
    var originalBlendMode = layer.blendMode;
    var originalOpacity = layer.opacity;
    var originalFillOpacity = layer.fillOpacity; // Note: Fill Opacity might not be fully transferable to the SO container in the same way, but usually SO has it.

    // 特殊情况：如果是"穿透"模式（通常用于组），智能对象不支持。
    // 我们只能让它变为正常，这确实会改变视觉效果，但在转换为SO的语境下，这是不可避免的。
    // 但是，如果包含的元素有混合模式，它们现在是在SO内部混合（针对透明背景），这可能就是用户想要"烘焙"的效果。
    // 只有当组本身作为整体去混合下层时，PassThrough丢失才会有问题。
    // 这里我们尽力恢复非PassThrough模式。

    // 2. 执行转换
    var idnewPlacedLayer = stringIDToTypeID("newPlacedLayer");
    executeAction(idnewPlacedLayer, undefined, DialogModes.NO);

    // 3. 恢复属性
    // 转换后，activeLayer 变成了新的智能对象
    var newLayer = app.activeDocument.activeLayer;

    // 恢复混合模式
    // 注意：如果是 PASSTHROUGH，设置给普通图层/智能对象会报错或无效，需检查
    if (originalBlendMode !== BlendMode.PASSTHROUGH) {
        try {
            newLayer.blendMode = originalBlendMode;
        } catch (e) {
            // 如果恢复失败，保持默认
        }
    }

    // 恢复不透明度
    if (originalOpacity < 100) {
        newLayer.opacity = originalOpacity;
    }

    // 恢复填充不透明度
    if (originalFillOpacity < 100) {
        newLayer.fillOpacity = originalFillOpacity;
    }
}

// ============================================================================
//                              ACTION MANAGER HELPERS
// ============================================================================

/**
 * 检查图层是否有开启的 Effects (图层样式)
 */
function hasEffects(layer) {
    try {
        var ref = new ActionReference();
        ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
        var desc = executeActionGet(ref);

        if (desc.hasKey(stringIDToTypeID("layerEffects"))) {
            var effects = desc.getObjectValue(stringIDToTypeID("layerEffects"));
            // 检查 'scale' 属性通常意味着 Effects 存在。
            // 也可以检查 'enabled'。实际上只要 layerEffects 键存在且非空通常意味着有样式。
            // 为了更严谨，我们可以检查是否可见。
            var isVisible = true;
            if (effects.hasKey(charIDToTypeID("enab"))) {
                isVisible = effects.getBoolean(charIDToTypeID("enab"));
            }
            return isVisible;
        }
    } catch (e) {
        // quiet fail
    }
    return false;
}

/**
 * 检查图层是否有链接的蒙版 (Pixel or Vector)
 */
function hasLinkedMask(layer) {
    try {
        var ref = new ActionReference();
        ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
        var desc = executeActionGet(ref);

        var hasUserMask = false;
        var hasVectorMask = false;
        var userMaskLinked = false;
        var vectorMaskLinked = false;

        // 检查 Pixel Mask (User Mask)
        if (desc.hasKey(stringIDToTypeID("hasUserMask"))) {
            hasUserMask = desc.getBoolean(stringIDToTypeID("hasUserMask"));
            if (hasUserMask && desc.hasKey(stringIDToTypeID("userMaskLinked"))) {
                userMaskLinked = desc.getBoolean(stringIDToTypeID("userMaskLinked"));
            }
        }

        // 检查 Vector Mask
        if (desc.hasKey(stringIDToTypeID("hasVectorMask"))) {
            hasVectorMask = desc.getBoolean(stringIDToTypeID("hasVectorMask"));
            if (hasVectorMask && desc.hasKey(stringIDToTypeID("vectorMaskLinked"))) {
                vectorMaskLinked = desc.getBoolean(stringIDToTypeID("vectorMaskLinked"));
            }
        }

        // 只要有一个存在的蒙版是链接状态，就需要转换
        if ((hasUserMask && userMaskLinked) || (hasVectorMask && vectorMaskLinked)) {
            return true;
        }

    } catch (e) {
        // quiet fail
    }
    return false;
}

// 运行主程序
main();

