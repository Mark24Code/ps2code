import { useEffect, useState } from 'react'
import { App, AutoComplete, Button, Card, Descriptions, Input, Select, Space, Tabs, Tag, Tooltip, Typography } from 'antd'
import { CopyOutlined, CheckOutlined, SettingOutlined, InfoCircleOutlined } from '@ant-design/icons'
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
  const [fingerprint, setFingerprint] = useState('')
  const [copied, setCopied] = useState(false)
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
    // 读取设备指纹
    window.api.analyticsGetFingerprint().then(setFingerprint).catch(() => setFingerprint('获取失败'))
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

  const copyFingerprint = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(fingerprint)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      message.error('复制失败')
    }
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: 24 }}>
      <Tabs
        defaultActiveKey="settings"
        items={[
          {
            key: 'settings',
            label: <span><SettingOutlined /> 设置</span>,
            children: (
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

                <Button type="primary" onClick={save}>
                  保存设置
                </Button>
              </Space>
            )
          },
          {
            key: 'about',
            label: <span><InfoCircleOutlined /> 关于</span>,
            children: (
              <Space orientation="vertical" size={16} style={{ width: '100%' }}>
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

                <Card title="设备信息" size="small">
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label={
                      <Space size={4}>
                        <span>设备码</span>
                        <Tooltip title={copied ? '已复制' : '复制设备码'}>
                          <span
                            onClick={copyFingerprint}
                            style={{ cursor: 'pointer', color: copied ? '#52c41a' : undefined }}
                          >
                            {copied ? <CheckOutlined /> : <CopyOutlined />}
                          </span>
                        </Tooltip>
                      </Space>
                    }>
                      <Typography.Text
                        code
                        copyable={false}
                        style={{ fontSize: 11, wordBreak: 'break-all' }}
                      >
                        {fingerprint || '加载中…'}
                      </Typography.Text>
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              </Space>
            )
          }
        ]}
      />
    </div>
  )
}
