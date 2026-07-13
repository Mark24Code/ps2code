import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { initDatabase } from './services/db'
import { detectAndPersistPsPath } from './services/photoshop'
import { IPC } from '../shared/ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
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
