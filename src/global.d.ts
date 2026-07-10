import type { Api } from '../electron/preload'
import 'react'

declare global {
  interface Window {
    api: Api
  }
}

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}

export {}
