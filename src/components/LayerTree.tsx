import { useEffect, useMemo, useState } from 'react'
import { Empty, Spin, Tree, Typography } from 'antd'
import { FolderOutlined, PictureOutlined } from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import type { PsdLayerNode, PsdMeta } from '@shared/types'

interface Props {
  psdPath: string
}

function toDataNode(node: PsdLayerNode): DataNode {
  const isGroup = node.kind === 'group'
  return {
    key: node.id,
    icon: isGroup ? <FolderOutlined /> : <PictureOutlined />,
    title: (
      <span style={{ opacity: node.hidden ? 0.45 : 1 }}>
        <span style={{ textDecoration: node.hidden ? 'line-through' : 'none' }}>{node.name}</span>
        <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
          {node.width}×{node.height}
        </Typography.Text>
      </span>
    ),
    children: node.children?.map(toDataNode)
  }
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

  const treeData = useMemo(() => (meta ? meta.tree.map(toDataNode) : []), [meta])

  if (error) return <Empty description={`图层读取失败:${error}`} />
  if (!meta) return <Spin style={{ display: 'block', padding: 24 }} tip="读取图层中…" />

  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        画布 {meta.width}×{meta.height} · {meta.groupCount} 组 / {meta.layerCount} 层
      </Typography.Text>
      <Tree showIcon defaultExpandedKeys={treeData.slice(0, 1).map((n) => n.key)} treeData={treeData} />
    </div>
  )
}
