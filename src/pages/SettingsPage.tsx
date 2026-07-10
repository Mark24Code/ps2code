import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'

const empty: AppSettings = {
  psPath: '',
  apiBaseUrl: '',
  apiKey: '',
  apiModel: 'claude-sonnet-4-5',
  defaultExportDir: ''
}

export function SettingsPage(): JSX.Element {
  const [s, setS] = useState<AppSettings>(empty)
  const [saved, setSaved] = useState(false)
  const [detected, setDetected] = useState<string>('')
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<{
    hasUpdate: boolean
    latest?: string
    url?: string
    error?: string
  } | null>(null)

  useEffect(() => {
    window.api.settingsGet().then(setS)
    window.api.appVersion().then(setVersion)
    window.api.psDetect().then((d) => setDetected(d ? `${d.app}${d.version ? ' ' + d.version : ''}` : '未检测到'))
  }, [])

  const set = (patch: Partial<AppSettings>): void => {
    setS((prev) => ({ ...prev, ...patch }))
    setSaved(false)
  }

  const save = async (): Promise<void> => {
    await window.api.settingsSet(s)
    setSaved(true)
  }

  const testPs = async (): Promise<void> => {
    setTestMsg(null)
    await window.api.settingsSet(s)
    setTestMsg(await window.api.psTest())
  }

  const pickPs = async (): Promise<void> => {
    const p = await window.api.pickDir()
    if (p) set({ psPath: p })
  }

  const pickExport = async (): Promise<void> => {
    const p = await window.api.pickDir()
    if (p) set({ defaultExportDir: p })
  }

  const check = async (): Promise<void> => {
    setUpdate(null)
    setUpdate(await window.api.checkUpdate())
  }

  return (
    <div className="settings">
      <div className="panel">
        <h3>Photoshop</h3>
        <div className="field">
          <label>Photoshop 路径</label>
          <div className="inline">
            <input
              value={s.psPath}
              placeholder={`自动检测: ${detected}`}
              onChange={(e) => set({ psPath: e.target.value })}
            />
            <button onClick={pickPs}>选择</button>
            <button onClick={testPs}>测试连接</button>
          </div>
          <span className="hint">留空则自动探测已安装的 Photoshop</span>
        </div>
        {testMsg && (
          <div className={`status-line ${testMsg.ok ? 'ok' : 'err'}`}>{testMsg.message}</div>
        )}
      </div>

      <div className="panel">
        <h3>API(Agent)</h3>
        <div className="field">
          <label>API 地址</label>
          <input
            value={s.apiBaseUrl}
            placeholder="https://api.anthropic.com(可留空用默认)"
            onChange={(e) => set({ apiBaseUrl: e.target.value })}
          />
        </div>
        <div className="field">
          <label>API 密钥</label>
          <input
            type="password"
            value={s.apiKey}
            placeholder="sk-..."
            onChange={(e) => set({ apiKey: e.target.value })}
          />
        </div>
        <div className="field">
          <label>模型</label>
          <input value={s.apiModel} onChange={(e) => set({ apiModel: e.target.value })} />
        </div>
      </div>

      <div className="panel">
        <h3>导出</h3>
        <div className="field">
          <label>默认导出路径</label>
          <div className="inline">
            <input
              value={s.defaultExportDir}
              placeholder="默认与设计稿同目录"
              onChange={(e) => set({ defaultExportDir: e.target.value })}
            />
            <button onClick={pickExport}>选择</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>关于</h3>
        <div className="field">
          <label>当前版本</label>
          <div>{version}</div>
        </div>
        <div className="inline">
          <button onClick={check}>检查更新</button>
          {update && !update.error && update.hasUpdate && (
            <span className="status-line ok">
              发现新版本 {update.latest}{' '}
              <button className="primary" onClick={() => update.url && window.api.openExternal(update.url)}>
                前往下载
              </button>
            </span>
          )}
          {update && !update.error && !update.hasUpdate && (
            <span className="status-line">已是最新版本</span>
          )}
          {update?.error && <span className="status-line err">{update.error}</span>}
        </div>
      </div>

      <div className="inline">
        <button className="primary" onClick={save}>
          保存设置
        </button>
        {saved && <span className="status-line ok">已保存</span>}
      </div>
    </div>
  )
}
