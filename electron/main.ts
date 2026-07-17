import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { initDatabase } from './services/db'
import { detectAndPersistPsPath } from './services/photoshop'
import { initAnalytics } from './services/analytics'
import { IPC } from '../shared/ipc'
import { existsSync } from 'fs'

let mainWindow: BrowserWindow | null = null

function getIconPath(): string {
  // dist 模式: resources 目录在 app 旁
  const distIcon = join(__dirname, '../../build/icon.png')
  if (existsSync(distIcon)) return distIcon
  // dev 模式: 相对于项目根目录
  const devIcon = join(app.getAppPath(), 'build/icon.png')
  if (existsSync(devIcon)) return devIcon
  return ''
}

function setAppIcon(): void {
  const iconPath = getIconPath()
  if (!iconPath) return
  // macOS: 用 nativeImage 设置 Dock 图标(dev 和 dist 都生效)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 850,
    minWidth: 900,
    minHeight: 500,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    icon: getIconPath(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 失去焦点后再次聚焦 → 用户可能在 PS 编辑过,通知渲染进程刷新设计稿状态
  let hadBlur = false
  mainWindow.on('blur', () => {
    hadBlur = true
  })
  mainWindow.on('focus', () => {
    if (hadBlur) {
      hadBlur = false
      mainWindow?.webContents.send(IPC.windowFocused)
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite 注入的开发服务器地址
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDatabase()
  registerIpc()
  initAnalytics()
  // 设置应用名称和图标
  app.setName('PS2Code')
  setAppIcon()
  // 初始化时检测并持久化 Photoshop 路径(不覆盖用户已配置的 psPath)。
  // 后台执行,失败不阻断启动。
  detectAndPersistPsPath().catch(() => {
    /* 检测失败:用户可在设置页手填路径 */
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
