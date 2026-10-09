export type Window = { kind: string; percentUsed: number; resetsAt?: string }

export type UsageSnap = { windows: Window[]; costUsd?: number; at: number }

export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  turns: number
}

export type Disk = { id: string; freeGB: number; sizeGB: number }

export type Gpu = {
  name: string
  util: number
  memUsedGB: number
  memTotalGB: number
  tempC: number | null
}

export type SysSnap = {
  cpu: number | null
  memUsedGB: number
  memTotalGB: number
  disks: Disk[]
  tzOffsetMin: number
  gpu: Gpu | null
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      usage: UsageSnap | null
      tokens: TokenTotals
      sys: SysSnap | null
      sysError: string | null
      isHidden: boolean
      isCompact: boolean
    }
  }
}
