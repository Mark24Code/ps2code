#!/usr/bin/env bash
# ============================================================================
# detect-ps.sh — 解析 Photoshop 应用名(供 scripts/*.sh source)
#
# 提供函数: ps_app_name
#   优先级:
#     1. ~/.ps2code/config.json 的 psPath(程序初始化写入的唯一真相源)
#        用 node 解析 JSON(与 Electron 技术栈一致,不依赖 python3)。
#        psPath 可能是 .app 全路径或应用名,统一取 basename 去 .app 后缀。
#     2. 回退:自动扫描 /Applications,覆盖两种安装布局:
#          /Applications/Adobe Photoshop 2024.app        (顶层)
#          /Applications/Adobe Photoshop 2024/*.app       (子目录)
#        过滤 presets/plug-in 噪音,取版本号最大者。
#     3. 都失败 → 返回非零。
#
# 输出: 应用名(如 "Adobe Photoshop 2024")到 stdout。
# 说明: 应用名必须与已安装版本完全一致,否则 AppleScript 无法解析术语字典,
#       会在编译期报 -2741 (预期是行的结尾) 错误。
# ============================================================================

_ps_basename_no_app() {
    # 从路径或名字取 basename 并去掉 .app 后缀
    local v="$1"
    v="${v##*/}"       # basename
    v="${v%.app}"      # 去 .app
    printf '%s' "$v"
}

_ps_from_config() {
    local cfg="$HOME/.ps2code/config.json"
    [[ -f "$cfg" ]] || return 1
    command -v node >/dev/null 2>&1 || return 1
    local ps_path
    ps_path="$(node -e '
        try {
            const fs = require("fs");
            const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            process.stdout.write((c.psPath || "").trim());
        } catch (e) { process.exit(1); }
    ' "$cfg" 2>/dev/null)" || return 1
    [[ -n "$ps_path" ]] || return 1
    _ps_basename_no_app "$ps_path"
}

_ps_from_scan() {
    local p
    p="$( { ls -d /Applications/Adobe\ Photoshop*.app 2>/dev/null
            ls -d /Applications/Adobe\ Photoshop*/*.app 2>/dev/null; } \
          | grep -iv 'presets\|plug-in\|scripting' | sort | tail -n1 )"
    [[ -n "$p" ]] || return 1
    _ps_basename_no_app "$p"
}

ps_app_name() {
    local name
    name="$(_ps_from_config)" && [[ -n "$name" ]] && { printf '%s' "$name"; return 0; }
    name="$(_ps_from_scan)"   && [[ -n "$name" ]] && { printf '%s' "$name"; return 0; }
    return 1
}
