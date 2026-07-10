// 导出文件命名与去重(纯函数,便于单测)

// 在已占用名字集合中为文件名求一个不冲突的名字。
// 重名时追加 _01/_02...,序号插在 @2x 标记之前以保留倍率命名:
//   组名.png       -> 组名_01.png
//   组名@2x.png     -> 组名_01@2x.png
export function dedupeFileName(fileName: string, taken: Set<string>): string {
  if (!taken.has(fileName)) return fileName
  const m = /^(.*?)(@2x)?(\.[^.]+)$/i.exec(fileName)
  const base = m ? m[1] : fileName
  const retina = m && m[2] ? m[2] : ''
  const ext = m ? m[3] : ''
  let i = 1
  let candidate = fileName
  do {
    const seq = String(i).padStart(2, '0')
    candidate = `${base}_${seq}${retina}${ext}`
    i++
  } while (taken.has(candidate))
  return candidate
}

// 为一批匹配到的图层组名生成导出名:唯一名保持原样;
// 重名则追加 _01/_02(补零位数按该名出现总数决定)。
// 返回与输入等长的导出名数组(顺序对应)。
export function assignExportNames(groupNames: string[]): string[] {
  const total: Record<string, number> = {}
  for (const n of groupNames) total[n] = (total[n] || 0) + 1
  const seq: Record<string, number> = {}
  return groupNames.map((name) => {
    if (total[name] <= 1) return name
    seq[name] = (seq[name] || 0) + 1
    const width = Math.max(2, String(total[name]).length)
    const s = String(seq[name]).padStart(width, '0')
    return `${name}_${s}`
  })
}
