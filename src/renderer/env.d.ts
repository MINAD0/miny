import type { MinyApi } from '../preload/index'

declare global {
  interface Window {
    miny: MinyApi
  }
}

export {}
