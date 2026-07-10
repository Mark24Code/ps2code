import { useState } from 'react'
import type { Conversation } from '@shared/types'

interface Props {
  conversation: Conversation
  busy: boolean
  onSend: (text: string) => void
  onUpdate: (c: Conversation) => void
}

// 对话框下方:导出选项(裁剪 / 1x / 2x / 导出路径)+ 输入框。
// 选项作为默认上下文,写回 conversation 供 Agent 导出工具读取。
export function Composer({ conversation, busy, onSend, onUpdate }: Props): JSX.Element {
  const [text, setText] = useState('')

  const patch = async (p: Partial<Conversation>): Promise<void> => {
    const next = await window.api.convUpdate(conversation.id, p)
    onUpdate(next)
  }

  const submit = (): void => {
    const t = text.trim()
    if (!t || busy) return
    onSend(t)
    setText('')
  }

  const pickExportDir = async (): Promise<void> => {
    const dir = await window.api.pickDir()
    if (dir) await patch({ exportDir: dir })
  }

  return (
    <div className="composer">
      <div className="opts">
        <label>
          <input
            type="checkbox"
            checked={conversation.optTrim}
            onChange={(e) => patch({ optTrim: e.target.checked })}
          />
          裁剪透明边
        </label>
        <label>
          <input
            type="checkbox"
            checked={conversation.opt1x}
            onChange={(e) => patch({ opt1x: e.target.checked })}
          />
          1倍图
        </label>
        <label>
          <input
            type="checkbox"
            checked={conversation.opt2x}
            onChange={(e) => patch({ opt2x: e.target.checked })}
          />
          2倍图
        </label>
        <span className="export-path">
          导出到:<span className="p" title={conversation.exportDir}>{conversation.exportDir || '(未设置)'}</span>
          <button className="ghost" onClick={pickExportDir}>
            修改
          </button>
        </span>
      </div>
      <div className="row">
        <textarea
          value={text}
          placeholder="描述你的需求,例如:把 组93 改名为 组193;或:导出所有以 icon 开头的图层组"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />
        <button className="primary" disabled={busy} onClick={submit}>
          发送
        </button>
      </div>
    </div>
  )
}
