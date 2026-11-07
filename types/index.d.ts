export type AgentRow = { id: string; label: string; type: string; status: string; parentId?: string; since: number }
export type Usage = {
  model: string
  tokens: number
  window: number
  percent: number
  usd: number
  fiveHour?: number
}

declare module 'claude-code' {
  interface PluginState {
    'token-coach': {
      lastDoneAt: number
      cachedTokens: number
      turns: number
      ttlMin: number
      isHidden: boolean
    }
  }
}
