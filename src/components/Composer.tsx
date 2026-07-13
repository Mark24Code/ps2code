import { useState } from 'react'
import { App, Button, Checkbox, Input, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  EditOutlined,
  FolderOpenOutlined,
  PaperClipOutlined,
  PauseCircleFilled
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
  onStop: () => void
  onUpdate: (c: Conversation) => void
}

// 对话框上方:设计稿别针标识 + PS 就绪状态。
// 下方:导出设置(分行展示,不挤一排)。最后是输入框。
export function Composer(props: Props): JSX.Element {
  const { conversation, busy, disabled, designName, readyState, readyMessage, onSend, onStop, onUpdate } =
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
        <CheckCircleFilled style={{ color: '#52c41a' }} />
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
      {/* 设计稿别针 + PS 就绪状态 */}
      <div className="composer-footer">
        <Tag icon={<PaperClipOutlined />} color="blue" variant="filled" className="design-pin">
          {designName ?? '设计稿'}
        </Tag>
        {statusIcon}
      </div>

      {/* 导出倍率 */}
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

      {/* 输入框 */}
      <div style={{ position: 'relative', width: '100%' }}>
        <Input.TextArea
          value={text}
          placeholder="描述你的需求…"
          autoSize={{ minRows: 1, maxRows: 5 }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Ctrl/Cmd+Enter → 换行
              if (e.ctrlKey || e.metaKey) return
              // 纯 Enter → 发送
              e.preventDefault()
              submit()
            }
          }}
          style={{ paddingRight: 140 }}
        />
        {busy ? (
          <Button
            type="text"
            size="small"
            danger
            icon={<PauseCircleFilled />}
            onClick={onStop}
            style={{
              position: 'absolute',
              right: 8,
              bottom: 6,
              lineHeight: '20px'
            }}
          >
            停止
          </Button>
        ) : (
          <Typography.Text
            type="secondary"
            style={{
              position: 'absolute',
              right: 10,
              bottom: 6,
              fontSize: 11,
              pointerEvents: 'none',
              lineHeight: '20px'
            }}
          >
            回车发送 · Ctrl+Enter 换行
          </Typography.Text>
        )}
      </div>

      {/* 导出路径(输入框下方) */}
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
        <Tooltip title="在访达中打开">
          <Button
            type="text"
            size="small"
            icon={<FolderOpenOutlined />}
            disabled={!conversation.exportDir}
            onClick={() => window.api.openPath(conversation.exportDir)}
          />
        </Tooltip>
        <Tooltip title="修改导出路径">
          <Button type="text" size="small" icon={<EditOutlined />} onClick={pickExportDir} />
        </Tooltip>
      </div>
    </div>
  )
}
