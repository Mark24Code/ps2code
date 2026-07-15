import { useEffect, useState } from 'react'
import { App, AutoComplete, Button, Card, Descriptions, Input, Select, Space, Tag, Typography } from 'antd'
import type { AppSettings } from '@shared/types'

const empty: AppSettings = {
  psPath: '',
  apiProvider: 'deepseek',
  apiModel: 'deepseek-v4-flash',
  defaultExportDir: ''
}

// pi-agent 支持的常见 provider(默认 DeepSeek)。
const PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek(默认)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'groq', label: 'Groq' },
  { value: 'xai', label: 'xAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'mistral', label: 'Mistral' }
]

// 各 provider 的常用模型建议(可手动输入其它模型)。
const MODEL_SUGGESTIONS: Record<string, string[]> = {
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  openai: ['gpt-5', 'gpt-5-mini'],
  anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5']
}

export function SettingsPage(): JSX.Element {
  const { message } = App.useApp()
  const [s, setS] = useState<AppSettings>(empty)
  const [apiKey, setApiKey] = useState('')
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
    // 从 auth.json 读取 apiKey
    window.api.authGet('deepseek').then(setApiKey).catch(() => {})
  }, [])

  const set = (patch: Partial<AppSettings>): void => setS((prev) => ({ ...prev, ...patch }))

  const save = async (): Promise<void> => {
    await window.api.settingsSet(s)
    // apiKey 单独存到 auth.json
    await window.api.authSet(s.apiProvider, apiKey)
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
    const res = await window.api.agentCheck({
      apiProvider: s.apiProvider,
      apiKey,
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
            由 pi-agent 驱动,默认使用 DeepSeek(OpenAI 兼容协议)。密钥保存在 ~/.ps2code/auth.json。留空则回退对应 provider 的系统环境变量(如 DEEPSEEK_API_KEY)。
          </Typography.Paragraph>
          <Space orientation="vertical" style={{ width: '100%' }} size={12}>
            <div>
              <Typography.Text type="secondary">Provider</Typography.Text>
              <Select
                style={{ width: '100%' }}
                value={s.apiProvider}
                options={PROVIDERS}
                onChange={(v) => set({ apiProvider: v })}
              />
            </div>
            <div>
              <Typography.Text type="secondary">API 密钥</Typography.Text>
              <Input.Password
                value={apiKey}
                placeholder="sk-..."
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div>
              <Typography.Text type="secondary">模型</Typography.Text>
              <AutoComplete
                style={{ width: '100%' }}
                value={s.apiModel}
                options={(MODEL_SUGGESTIONS[s.apiProvider] ?? []).map((m) => ({ value: m }))}
                onChange={(v) => set({ apiModel: v })}
              >
                <Input placeholder="deepseek-v4-flash" />
              </AutoComplete>
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
