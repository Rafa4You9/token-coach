declare module 'claude-code' {
  interface PluginState {
    'token-coach': {
      lastDoneAt: number
      turns: number
      ttlMin: number
      isDirector: boolean
    }
  }
}

export {}
