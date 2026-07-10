import { useState } from 'react'
import { App, Button, Checkbox, Input, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  EditOutlined,
  PaperClipOutlined,
  SendOutlined
} from '@ant-design/icons'
import type { Conversation } from '@shared/types'

interface Props {
  conversation: Conversation
  busy: boolean
  disabled?: boolean
  designName?: string
  readyState?: 'idle' | 'loading' | 'ok' | 'error'
  readyMessage?: string
  onSend: (text: string) => void
  onUpdate: (c: Conversation) => void
}

// 对话框上方:设计稿别针标识 + PS 就绪状态。
// 下方:导出设置(分行展示,不挤一排)。最后是输入框。
export function Composer(props: Props): JSX.Element {
  const { conversation, busy, disabled, designName, readyState, readyMessage, onSend, onUpdate } =
    props
  const { message } = App.useApp()
  const [text, setText] = useState('')

  const patch = async (p: Partial<Conversation>): Promise<void> => {
    const next = await window.api.convUpdate(conversation.id, p)
    onUpdate(next)
  }

  const submit = (): void => {
    const t = text.trim()
    if (!t || busy) return
    // 设计稿未就绪:不发送,弹 Toast 提示更换设计稿
    if (disabled) {
      message.warning(
        readyState === 'error'
          ? `设计稿未就绪:${readyMessage || '无法访问设计稿'}。请更换设计稿或重试。`
          : 'Photoshop 正在打开设计稿,请稍候…'
      )
      return
    }
    onSend(t)
    setText('')
  }

  const pickExportDir = async (): Promise<void> => {
    const dir = await window.api.pickDir()
    if (dir) await patch({ exportDir: dir })
  }

  // PS 就绪状态图标:绿勾 / 加载 / 红叉(悬浮显示报错)
  const statusIcon =
    readyState === 'ok' ? (
      <Tooltip title="Photoshop 已就绪">
        <CheckCircleFilled style={{ color: 'var(--ok, #2e7d46)' }} />
      </Tooltip>
    ) : readyState === 'loading' ? (
      <Tooltip title="正在打开 Photoshop…">
        <span style={{ display: 'inline-flex' }}>
          <Spin size="small" />
        </span>
      </Tooltip>
    ) : readyState === 'error' ? (
      <Tooltip title={readyMessage || '无法访问设计稿'}>
        <CloseCircleFilled style={{ color: '#c0392b' }} />
      </Tooltip>
    ) : null

  return (
    <div className="composer">
      {/* 导出设置(分行) */}
      <div className="composer-opts">
        <div className="opt-row">
          <Typography.Text type="secondary" className="opt-label">
            导出倍率
          </Typography.Text>
          <Space size={16}>
            <Checkbox checked={conversation.opt1x} onChange={(e) => patch({ opt1x: e.target.checked })}>
              1倍图
            </Checkbox>
            <Checkbox checked={conversation.opt2x} onChange={(e) => patch({ opt2x: e.target.checked })}>
              2倍图
            </Checkbox>
            <Checkbox
              checked={conversation.optTrim}
              onChange={(e) => patch({ optTrim: e.target.checked })}
            >
              裁剪透明边
            </Checkbox>
          </Space>
        </div>
        <div className="opt-row">
          <Typography.Text type="secondary" className="opt-label">
            导出路径
          </Typography.Text>
          <Typography.Text
            ellipsis={{ tooltip: conversation.exportDir }}
            style={{ flex: 1, fontSize: 12 }}
          >
            {conversation.exportDir || '(未设置)'}
          </Typography.Text>
          <Tooltip title="修改导出路径">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={pickExportDir} />
          </Tooltip>
        </div>
      </div>

      {/* 输入框 */}
      <Space.Compact style={{ width: '100%' }}>
        <Input.TextArea
          value={text}
          placeholder="描述你的需求,例如:把 组93 改名为 组193;或:导出所有以 icon 开头的图层组(⌘/Ctrl+Enter 发送)"
          autoSize={{ minRows: 2, maxRows: 5 }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          disabled={busy}
          onClick={submit}
          style={{ height: 'auto' }}
        >
          发送
        </Button>
      </Space.Compact>

      {/* 底部右下角:设计稿别针 + PS 就绪状态图标 */}
      <div className="composer-footer">
        <Tag icon={<PaperClipOutlined />} color="blue" variant="filled" className="design-pin">
          {designName ?? '设计稿'}
        </Tag>
        {statusIcon}
      </div>
    </div>
  )
}
