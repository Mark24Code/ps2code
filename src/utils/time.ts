// 相对时间:2d / 1mo 之类的紧凑展示(用于对话列表)
export function relativeTime(iso: string): string {
  if (!iso) return ''
  // sqlite 存的是 'YYYY-MM-DD HH:MM:SS'(UTC),补 Z 以正确解析
  const ts = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(ts)) return ''
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}天`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}个月`
  return `${Math.floor(mo / 12)}年`
}
