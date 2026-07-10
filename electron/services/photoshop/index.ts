import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getSettings } from '../db'

const execAsync = promisify(exec)

export interface PsInfo {
  app: string
  version?: string
}

export interface PhotoshopBridge {
  detect(): Promise<PsInfo | null>
  runJsx(jsxSource: string): Promise<string>
  runJsxFile(path: string): Promise<string>
}

// ---------------- macOS ----------------
class MacBridge implements PhotoshopBridge {
  async detect(): Promise<PsInfo | null> {
    // 1) 正在运行的 PS 进程
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "System Events" to get name of (first process whose name contains "Photoshop")'`
      )
      const name = stdout.trim()
      if (name) return { app: name }
    } catch {
      /* 未运行,继续探测已安装 */
    }
    // 2) 已安装的应用
    try {
      const { stdout } = await execAsync(
        `ls -d /Applications/Adobe\\ Photoshop* 2>/dev/null | head -n1`
      )
      const p = stdout.trim()
      if (p) {
        const base = p.split('/').pop()?.replace(/\.app$/, '') ?? 'Adobe Photoshop'
        return { app: base }
      }
    } catch {
      /* ignore */
    }
    return null
  }

  private async appName(): Promise<string> {
    const configured = getSettings().psPath
    if (configured) {
      const base = configured.split('/').pop()?.replace(/\.app$/, '')
      if (base) return base
    }
    const info = await this.detect()
    if (!info) throw new Error('未找到 Adobe Photoshop,请在设置中配置路径。')
    return info.app
  }

  async runJsxFile(path: string): Promise<string> {
    const appName = await this.appName()
    // 不使用 activate:让 PS 在后台执行/打开设计稿,不抢焦点、不切换前台窗口。
    // do javascript 无需将 PS 置前即可执行。UTF-8 读入避免中文乱码。
    const script = `tell application "${appName}"
  do javascript (read POSIX file "${path}" as «class utf8»)
end tell`
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      maxBuffer: 1024 * 1024 * 32
    })
    return stdout.trim()
  }

  async runJsx(jsxSource: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ps2code-jsx-'))
    const file = join(dir, 'script.jsx')
    await writeFile(file, jsxSource, 'utf8')
    try {
      return await this.runJsxFile(file)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

// ---------------- Windows ----------------
// Photoshop 的 COM 接口只有 DoJavaScript(code, args, mode),没有 DoJavaScriptFile。
// 为规避命令行转义与中文编码问题:生成临时 .ps1 脚本,读入 JSX(UTF-8)后调用 DoJavaScript,
// 结果以 UTF-8 写到临时输出文件,再由 Node 读回。
class WinBridge implements PhotoshopBridge {
  private async runPowerShell(psScript: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ps2code-ps-'))
    const ps1 = join(dir, 'run.ps1')
    await writeFile(ps1, '﻿' + psScript, 'utf8') // BOM 确保 PowerShell 按 UTF-8 读
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`,
        { maxBuffer: 1024 * 1024 * 32 }
      )
      return stdout
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  async detect(): Promise<PsInfo | null> {
    try {
      const out = await this.runPowerShell(
        `try {
  $a = New-Object -ComObject Photoshop.Application
  Write-Output ($a.Name + "|" + $a.Version)
} catch { exit 1 }`
      )
      const line = out.trim()
      if (line) {
        const [app, version] = line.split('|')
        return { app: app || 'Adobe Photoshop', version: version || undefined }
      }
    } catch {
      /* ignore */
    }
    return null
  }

  async runJsxFile(path: string): Promise<string> {
    const outFile = join(await mkdtemp(join(tmpdir(), 'ps2code-out-')), 'result.txt')
    // 用单引号包裹路径,内部单引号转义为 ''
    const jsxPathLit = path.replace(/'/g, "''")
    const outLit = outFile.replace(/'/g, "''")
    const script = `$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject Photoshop.Application
$code = [System.IO.File]::ReadAllText('${jsxPathLit}', [System.Text.Encoding]::UTF8)
$result = $app.DoJavaScript($code)
[System.IO.File]::WriteAllText('${outLit}', [string]$result, (New-Object System.Text.UTF8Encoding($false)))`
    try {
      await this.runPowerShell(script)
      const { readFile } = await import('fs/promises')
      return (await readFile(outFile, 'utf8')).trim()
    } finally {
      await rm(join(outFile, '..'), { recursive: true, force: true })
    }
  }

  async runJsx(jsxSource: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ps2code-jsx-'))
    const file = join(dir, 'script.jsx')
    await writeFile(file, jsxSource, 'utf8')
    try {
      return await this.runJsxFile(file)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

let bridge: PhotoshopBridge | null = null

export function getBridge(): PhotoshopBridge {
  if (!bridge) {
    bridge = process.platform === 'win32' ? new WinBridge() : new MacBridge()
  }
  return bridge
}

// 测试用:注入假的 Bridge(无需真实 Photoshop 即可验证脚本拼接/解析链路)
export function setBridgeForTest(fake: PhotoshopBridge | null): void {
  bridge = fake
}
