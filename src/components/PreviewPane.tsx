import { useEffect, useState } from 'react'
import type { Conversation } from '@shared/types'

interface Props {
  conversation: Conversation
  nonce: number // 变化时刷新
}

// 右侧预览:展示本对话 tmp 目录下的导出产物;用户确认后导出到目标路径。
export function PreviewPane({ conversation, nonce }: Props): JSX.Element {
  const [items, setItems] = useState<{ name: string; dataUrl: string }[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => {
    window.api.previewList(conversation.id).then(setItems)
  }, [conversation.id, nonce])

  const confirmExport = async (): Promise<void> => {
    setMsg('')
    const res = await window.api.exportConfirm(conversation.id)
    setMsg(`已导出 ${res.count} 个文件到 ${res.dir}`)
  }

  return (
    <div className="preview">
      <div className="head">
        <span>预览({items.length})</span>
        <span className="spacer" />
        <button className="ghost" onClick={() => window.api.openPath(conversation.exportDir)}>
          打开目录
        </button>
        <button className="primary" disabled={items.length === 0} onClick={confirmExport}>
          确认导出
        </button>
      </div>
      {items.length === 0 ? (
        <div className="empty">暂无预览。让 Agent 执行导出后,结果会显示在这里。</div>
      ) : (
        <div className="grid">
          {items.map((it) => (
            <div key={it.name} className="thumb">
              <img src={it.dataUrl} alt={it.name} />
              <div className="cap" title={it.name}>
                {it.name}
              </div>
            </div>
          ))}
        </div>
      )}
      {msg && <div className="status-line ok" style={{ padding: '8px 16px' }}>{msg}</div>}
    </div>
  )
}
