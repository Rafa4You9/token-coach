export type DayStats = { big: number; bigNoDeleg: number; opusTurns: number }

declare module 'claude-code' {
  interface PluginState {
    'token-coach': {
      lastDoneAt: number
      turns: number
      ttlMin: number
      isDirector: boolean
      // v0.6: lo que el mod mide en el bucle principal
      turnCalls: number
      turnMech: number
      turnDeleg: number
      turnNudgedAt: number
      turnTools: Record<string, number>
      sessCalls: number
      sessMech: number
      sessRoutine: number
      sessDeleg: number
      spend: Record<string, number>
      tipTurn: Record<string, number>
      pending: Record<string, number>
    }
  }
}
