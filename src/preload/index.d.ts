import type { Api } from '../shared/ipc'

declare global {
  interface Window {
    api: Api
    hkd: {
      platform: NodeJS.Platform
      versions: NodeJS.ProcessVersions
    }
  }
}

export {}
