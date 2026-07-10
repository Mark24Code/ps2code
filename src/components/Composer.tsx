import { useState } from 'react'
import { Button, Checkbox, Input, Space, Tooltip, Typography } from 'antd'
import { EditOutlined, SendOutlined } from '@ant-design/icons'
import type { Conversation } from '@shared/types'

interface Props {
  conversation: Conversation
  busy: boolean
  disabled?: boolean
  onSend: (text: string) => void
  onUpdate: (c: Conversation) => void
}

// 对话框下方:导出选项(裁剪 / 1x / 2x / 导出路径)+ 输入框。
// 选项作为默认上下文,写回 conversation 供 Agent 导出工具读取。
export function Composer({ conversation, busy, disabled, onSend, onUpdate }: Props): JSX.Element {
  const [text, setText] = useState('')

  const patch = async (p: Partial<Conversation>): Promise<void> => {
    const next = await window.api.convUpdate(conversation.id, p)
    onUpdate(next)
  }

  const submit = (): void => {
    const t = text.trim()
    if (!t || busy || disabled) return
    onSend(t)
    setText('')
  }

  const pickExportDir = async (): Promise<void> => {
    const dir = await window.api.pickDir()
    if (dir) await patch({ exportDir: dir })
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: '#fff', padding: '12px 16px' }}>
      <Space size={16} wrap style={{ marginBottom: 10 }}>
        <Checkbox checked={conversation.optTrim} onChange={(e) => patch({ optTrim: e.target.checked })}>
          裁剪透明边
        </Checkbox>
        <Checkbox checked={conversation.opt1x} onChange={(e) => patch({ opt1x: e.target.checked })}>
          1倍图
        </Checkbox>
        <Checkbox checked={conversation.opt2x} onChange={(e) => patch({ opt2x: e.target.checked })}>
          2倍图
        </Checkbox>
        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            导出到:
          </Typography.Text>
          <Typography.Text
            type="secondary"
            ellipsis={{ tooltip: conversation.exportDir }}
            style={{ fontSize: 12, maxWidth: 200, display: 'inline-block', verticalAlign: 'bottom' }}
          >
            {conversation.exportDir || '(未设置)'}
          </Typography.Text>
          <Tooltip title="修改导出路径">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={pickExportDir} />
          </Tooltip>
        </Space>
      </Space>
      <Space.Compact style={{ width: '100%' }}>
        <Input.TextArea
          value={text}
          disabled={disabled}
          placeholder={
            disabled
              ? '等待 Photoshop 与设计稿就绪…'
              : '描述你的需求,例如:把 组93 改名为 组193;或:导出所有以 icon 开头的图层组(⌘/Ctrl+Enter 发送)'
          }
          autoSize={{ minRows: 2, maxRows: 5 }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          disabled={busy || disabled}
          onClick={submit}
          style={{ height: 'auto' }}
        >
          发送
        </Button>
      </Space.Compact>
    </div>
  )
}
