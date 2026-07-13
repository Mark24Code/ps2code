import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Empty, Spin, Tooltip, Tree, Typography } from 'antd'
import { FolderOutlined, PictureOutlined, ReloadOutlined } from '@ant-design/icons'
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
  const { message } = App.useApp()
  const [meta, setMeta] = useState<PsdMeta | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback((): void => {
    setError('')
    setLoading(true)
    window.api
      .psdRead(psdPath)
      .then(setMeta)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [psdPath])

  const refresh = useCallback((): void => {
    setError('')
    setLoading(true)
    window.api
      .psdRead(psdPath)
      .then((m) => {
        setMeta(m)
        message.success('图层已刷新')
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [psdPath, message])

  useEffect(() => {
    setMeta(null)
    load()
  }, [load])

  // 窗口失焦后重新聚焦(用户可能在 PS 编辑过)→ 防抖后自动刷新一次最新状态
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.api.onWindowFocused(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => load(), 800)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [load])

  const treeData = useMemo(() => (meta ? meta.tree.map(toDataNode) : []), [meta])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingBottom: 8,
          borderBottom: '1px solid var(--border)'
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1 }}>
          {meta
            ? `画布 ${meta.width}×${meta.height} · ${meta.groupCount} 组 / ${meta.layerCount} 层`
            : '图层结构'}
        </Typography.Text>
        <Tooltip title="获取最新图层信息">
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={refresh}
          >
            刷新
          </Button>
        </Tooltip>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, paddingTop: 8 }}>
        {error ? (
          <Empty description={`图层读取失败:${error}`} />
        ) : !meta ? (
          <Spin style={{ display: 'block', padding: 24 }} />
        ) : (
          <Tree
            showIcon
            defaultExpandedKeys={treeData.slice(0, 1).map((n) => n.key)}
            treeData={treeData}
          />
        )}
      </div>
    </div>
  )
}
