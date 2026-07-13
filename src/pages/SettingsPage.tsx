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
  const [checking, setChecking] = useState(false)
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

  const checkAgent = async (): Promise<void> => {
    setChecking(true)
    // 用当前(未保存的)草稿配置检查
    const res = await window.api.agentCheck({
      apiBaseUrl: s.apiBaseUrl,
      apiKey: s.apiKey,
      apiModel: s.apiModel
    })
    setChecking(false)
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
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Card title="Photoshop" size="small">
          <Space orientation="vertical" style={{ width: '100%' }}>
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
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -4 }}>
            默认使用 Claude。留空则回退系统环境变量:ANTHROPIC_AUTH_TOKEN、ANTHROPIC_BASE_URL、ANTHROPIC_MODEL(兼容 DeepSeek 等 Anthropic 协议端点)。
          </Typography.Paragraph>
          <Space orientation="vertical" style={{ width: '100%' }} size={12}>
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
            <Button loading={checking} onClick={checkAgent}>
              检查连接
            </Button>
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
          <Descriptions column={1} size="small" style={{ marginBottom: 8 }}>
            <Descriptions.Item label="当前版本">{version}</Descriptions.Item>
            <Descriptions.Item label="作者">Mark24Code</Descriptions.Item>
            <Descriptions.Item label="项目主页">
              <a
                onClick={() => window.api.openExternal('https://github.com/Mark24Code/ps2code')}
                style={{ cursor: 'pointer' }}
              >
                https://github.com/Mark24Code/ps2code
              </a>
            </Descriptions.Item>
          </Descriptions>
          <Space>
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
