import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Project } from '@shared/types'

export function HomePage(): JSX.Element {
  const nav = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [over, setOver] = useState(false)
  const [error, setError] = useState('')

  const refresh = (): void => {
    window.api.projectList().then(setProjects)
  }
  useEffect(refresh, [])

  const openPsd = async (psdPath: string): Promise<void> => {
    if (!psdPath.toLowerCase().endsWith('.psd')) {
      setError('只支持 .psd 文件')
      return
    }
    setError('')
    const project = await window.api.projectImport(psdPath)
    nav(`/project/${project.id}`)
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const path = window.api.getPathForFile(file)
    await openPsd(path)
  }

  const onClickPick = async (): Promise<void> => {
    const path = await window.api.pickPsd()
    if (path) await openPsd(path)
  }

  const del = async (e: React.MouseEvent, id: number): Promise<void> => {
    e.stopPropagation()
    await window.api.projectDelete(id)
    refresh()
  }

  return (
    <div className="home">
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={onClickPick}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <div className="plus">+</div>
        <div>拖拽 PSD 设计稿到此,或点击选择文件</div>
      </div>
      {error && <div className="status-line err">{error}</div>}

      <div className="project-list">
        <p className="section-title">项目</p>
        {projects.length === 0 && <div className="empty">还没有项目,先导入一个 PSD 吧</div>}
        {projects.map((p) => (
          <div key={p.id} className="card" onClick={() => nav(`/project/${p.id}`)}>
            <div className="meta">
              <div className="name">{p.name}</div>
              <div className="path">{p.psdPath}</div>
            </div>
            <button className="danger" onClick={(e) => del(e, p.id)}>
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
