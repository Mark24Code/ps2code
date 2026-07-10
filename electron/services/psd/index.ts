import { readFile } from 'fs/promises'
import { readPsd, type Psd } from 'ag-psd'
import type { PsdMeta } from '../../../shared/types'
import { normalizeTree } from './normalize'

export async function readPsdMeta(psdPath: string): Promise<PsdMeta> {
  const buf = await readFile(psdPath)
  // 只取结构,跳过像素与合成图,快且省内存
  const psd: Psd = readPsd(buf, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true
  })

  const { tree, groupCount, layerCount } = normalizeTree(psd.children)

  return {
    width: psd.width,
    height: psd.height,
    layerCount,
    groupCount,
    tree
  }
}
