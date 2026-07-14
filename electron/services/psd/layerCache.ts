import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { PsdMeta } from '../../../shared/types'
import { readPsdMeta } from './index'
import { sessionDir } from '../agent/logStore'

// 每对话的图层缓存文件:~/.ps2code/sessions/<id>/layers.json。
// 进入对话时准备一次;窗口回到 app / 用户点刷新时重建。
// Agent 与渲染层都读它,避免每次现读现解析 PSD。

export interface LayerCacheFile {
  psdPath: string
  cachedAt: number
  meta: PsdMeta
}

export function layerCachePath(conversationId: string): string {
  // sessionDir 会自动创建目录
  return join(sessionDir(conversationId), 'layers.json')
}

// 现读 PSD 并写入缓存文件,返回 meta。
export async function buildLayerCache(
  conversationId: string,
  psdPath: string
): Promise<PsdMeta> {
  const meta = await readPsdMeta(psdPath)
  const payload: LayerCacheFile = { psdPath, cachedAt: Date.now(), meta }
  try {
    await writeFile(layerCachePath(conversationId), JSON.stringify(payload), 'utf8')
  } catch {
    /* 写盘失败不阻断:仍返回 meta */
  }
  return meta
}

// 读缓存文件;不存在/损坏/psdPath 不匹配时返回 null。
export async function readLayerCache(
  conversationId: string,
  psdPath?: string
): Promise<PsdMeta | null> {
  const file = layerCachePath(conversationId)
  if (!existsSync(file)) return null
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as LayerCacheFile
    if (psdPath && parsed.psdPath !== psdPath) return null
    if (!parsed.meta || !Array.isArray(parsed.meta.tree)) return null
    return parsed.meta
  } catch {
    return null
  }
}

// 缓存优先:命中且 psdPath 匹配则读缓存;否则现读并落盘(回退)。
export async function getLayerMeta(
  conversationId: string,
  psdPath: string
): Promise<PsdMeta> {
  const cached = await readLayerCache(conversationId, psdPath)
  if (cached) return cached
  return buildLayerCache(conversationId, psdPath)
}
