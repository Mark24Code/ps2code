import { useEffect, useState } from 'react'
import { App, Button, Card, Descriptions, Input, Space, Tag, Typography } from 'antd'
import type { AppSettings } from '@shared/types'

const empty: AppSettings = {
  psPath: '',
  apiBaseUrl: '',
  apiKey: '',
  apiModel: 'claude-sonnet-4-5',
  defaultExportDir: ''
}

export function SettingsPage(): JSX.Element {
  const { message } = App.useApp()
  const [s, setS] = useState<AppSettings>(empty)
  const [detected, setDetected] = useState('检测中…')
  const [version, setVersion] = useState('')
  const [testing, setTesting] = useState(false)
  const [update, setUpdate] = useState<{
    hasUpdate: boolean
    latest?: string
    url?: string
    error?: string
  } | null>(null)

  useEffect(() => {
    window.api.settingsGet().then(setS)
    window.api.appVersion().then(setVersion)
    window.api
      .psDetect()
      .then((d) => setDetected(d ? `${d.app}${d.version ? ' ' + d.version : ''}` : '未检测到'))
  }, [])

  const set = (patch: Partial<AppSettings>): void => setS((prev) => ({ ...prev, ...patch }))

  const save = async (): Promise<void> => {
    await window.api.settingsSet(s)
    message.success('已保存')
  }

  const testPs = async (): Promise<void> => {
    setTesting(true)
    await window.api.settingsSet(s)
    const res = await window.api.psTest()
    setTesting(false)
    res.ok ? message.success(res.message) : message.error(res.message)
  }

  const pick = async (key: 'psPath' | 'defaultExportDir'): Promise<void> => {
    const p = await window.api.pickDir()
    if (p) set({ [key]: p } as Partial<AppSettings>)
  }

  const check = async (): Promise<void> => {
    setUpdate(null)
    setUpdate(await window.api.checkUpdate())
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title="Photoshop" size="small">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text type="secondary">Photoshop 路径(留空则自动探测)</Typography.Text>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={s.psPath}
                placeholder={`自动检测: ${detected}`}
                onChange={(e) => set({ psPath: e.target.value })}
              />
              <Button onClick={() => pick('psPath')}>选择</Button>
              <Button loading={testing} onClick={testPs}>
                测试连接
              </Button>
            </Space.Compact>
          </Space>
        </Card>

        <Card title="API(Agent)" size="small">
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <div>
              <Typography.Text type="secondary">API 地址</Typography.Text>
              <Input
                value={s.apiBaseUrl}
                placeholder="https://api.anthropic.com(可留空用默认)"
                onChange={(e) => set({ apiBaseUrl: e.target.value })}
              />
            </div>
            <div>
              <Typography.Text type="secondary">API 密钥</Typography.Text>
              <Input.Password
                value={s.apiKey}
                placeholder="sk-..."
                onChange={(e) => set({ apiKey: e.target.value })}
              />
            </div>
            <div>
              <Typography.Text type="secondary">模型</Typography.Text>
              <Input value={s.apiModel} onChange={(e) => set({ apiModel: e.target.value })} />
            </div>
          </Space>
        </Card>

        <Card title="导出" size="small">
          <Typography.Text type="secondary">默认导出路径</Typography.Text>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={s.defaultExportDir}
              placeholder="默认与设计稿同目录"
              onChange={(e) => set({ defaultExportDir: e.target.value })}
            />
            <Button onClick={() => pick('defaultExportDir')}>选择</Button>
          </Space.Compact>
        </Card>

        <Card title="关于" size="small">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="当前版本">{version}</Descriptions.Item>
          </Descriptions>
          <Space style={{ marginTop: 8 }}>
            <Button onClick={check}>检查更新</Button>
            {update && !update.error && update.hasUpdate && (
              <>
                <Tag color="blue">发现新版本 {update.latest}</Tag>
                <Button
                  type="primary"
                  onClick={() => update.url && window.api.openExternal(update.url)}
                >
                  前往下载
                </Button>
              </>
            )}
            {update && !update.error && !update.hasUpdate && (
              <Typography.Text type="secondary">已是最新版本</Typography.Text>
            )}
            {update?.error && <Typography.Text type="danger">{update.error}</Typography.Text>}
          </Space>
        </Card>

        <Button type="primary" onClick={save}>
          保存设置
        </Button>
      </Space>
    </div>
  )
}
