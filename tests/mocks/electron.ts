// 测试用 electron stub。仅覆盖被测代码在导入期/运行期会触碰的 API。
export const app = {
  getPath: (): string => '/tmp/ps2code-test',
  getVersion: (): string => '0.0.0-test',
  getAppPath: (): string => process.cwd(),
  isPackaged: false
}

export const ipcMain = {
  handle: (): void => {}
}

export const shell = {
  openPath: async (): Promise<string> => '',
  openExternal: async (): Promise<void> => {}
}

export const dialog = {
  showOpenDialog: async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
    canceled: true,
    filePaths: []
  })
}

export const BrowserWindow = class {}
export const contextBridge = { exposeInMainWorld: (): void => {} }
export const ipcRenderer = { invoke: async (): Promise<unknown> => null, on: (): void => {}, removeListener: (): void => {} }
export const webUtils = { getPathForFile: (): string => '' }

export default { app, ipcMain, shell, dialog, BrowserWindow, contextBridge, ipcRenderer, webUtils }
