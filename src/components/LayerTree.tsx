import { useEffect, useState } from 'react'
import type { PsdLayerNode, PsdMeta } from '@shared/types'

interface Props {
  psdPath: string
}

function TreeNode({ node, depth }: { node: PsdLayerNode; depth: number }): JSX.Element {
  const [open, setOpen] = useState(depth < 1)
  const isGroup = node.kind === 'group'
  return (
    <div className="tree-node">
      <div
        className="tree-row"
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => isGroup && setOpen((o) => !o)}
      >
        <span className="tree-caret">{isGroup ? (open ? '▾' : '▸') : '·'}</span>
        <span className={`tree-name ${node.hidden ? 'hidden' : ''}`}>{node.name}</span>
        <span className="tree-size">
          {node.width}×{node.height}
        </span>
      </div>
      {isGroup && open && node.children?.map((c) => <TreeNode key={c.id} node={c} depth={depth + 1} />)}
    </div>
  )
}

export function LayerTree({ psdPath }: Props): JSX.Element {
  const [meta, setMeta] = useState<PsdMeta | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
    setMeta(null)
    window.api
      .psdRead(psdPath)
      .then(setMeta)
      .catch((e) => setError(String(e)))
  }, [psdPath])

  if (error) return <div className="empty">图层读取失败:{error}</div>
  if (!meta) return <div className="empty">读取图层中…</div>

  return (
    <div className="layer-tree">
      <div className="tree-summary">
        画布 {meta.width}×{meta.height} · {meta.groupCount} 组 / {meta.layerCount} 层
      </div>
      {meta.tree.map((n) => (
        <TreeNode key={n.id} node={n} depth={0} />
      ))}
    </div>
  )
}
