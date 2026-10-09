import type { SysSnap } from '../types'

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function bar(percent: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function tone(percent: number): 'success' | 'warning' | 'error' {
  if (percent >= 85) return 'error'
  if (percent >= 60) return 'warning'

  return 'success'
}

// five_hour is the rolling session window (the closest thing to a "daily" bar);
// seven_day is the weekly cap; seven_day_<model> is a per-model weekly cap.
export function windowLabel(kind: string): string {
  if (kind === 'five_hour') return '5-hour'
  if (kind === 'seven_day') return 'Weekly'
  if (kind === 'spend_limit') return 'Spend limit'
  if (kind.startsWith('seven_day_')) {
    const model = kind.slice('seven_day_'.length).replace(/_/g, ' ')

    return `Weekly ${model.charAt(0).toUpperCase()}${model.slice(1)}`
  }

  return kind.replace(/_/g, ' ')
}

export function windowOrder(kind: string): number {
  if (kind === 'five_hour') return 0
  if (kind === 'seven_day') return 1
  if (kind.startsWith('seven_day_')) return 2

  return 3
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`

  return String(n)
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return 'now'
  const minutes = Math.round(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`

  return `${mins}m`
}

// Local wall-clock time from UTC getters plus an explicit offset, so the result
// does not depend on the time zone the hooks environment happens to run in.
export function fmtLocal(ms: number, tzOffsetMin: number, withDate: boolean): string {
  const d = new Date(ms + tzOffsetMin * 60_000)
  const h24 = d.getUTCHours()
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const time = `${h12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
  if (!withDate) return time

  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${time}`
}

export function fmtReset(iso: string | undefined, nowMs: number, tzOffsetMin: number): string {
  if (!iso) return 'reset time unknown'
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return 'reset time unknown'
  const withDate = at - nowMs > 20 * 3_600_000

  return `resets ${fmtLocal(at, tzOffsetMin, withDate)} (in ${fmtDuration(at - nowMs)})`
}

// PowerShell one-liner that prints one JSON object with CPU, memory, fixed
// disks and the local UTC offset. Run with no shell, so no extra quoting.
export const SYS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$c=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average',
  '$o=Get-CimInstance Win32_OperatingSystem',
  "$d=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [pscustomobject]@{ id=$_.DeviceID; free=[double]$_.FreeSpace; size=[double]$_.Size } })",
  '$tz=[int][System.TimeZoneInfo]::Local.GetUtcOffset([datetime]::Now).TotalMinutes',
  // GPU from nvidia-smi when it is installed (about 0.1 s); Windows' own GPU
  // counters take seconds to read, so other GPUs are left out.
  "$g=$null; try { $ns=Get-Command nvidia-smi -ErrorAction SilentlyContinue; if ($ns) { $l=@(& $ns.Source --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits)[0]; if ($l) { $p=$l -split ',\\s*'; $g=[pscustomobject]@{ name=$p[0]; util=[double]$p[1]; memUsedMB=[double]$p[2]; memTotalMB=[double]$p[3]; tempC=[double]$p[4] } } } } catch { $g=$null }",
  '[pscustomobject]@{ cpu=$c; freeKB=[double]$o.FreePhysicalMemory; totalKB=[double]$o.TotalVisibleMemorySize; disks=$d; tz=$tz; gpu=$g } | ConvertTo-Json -Compress -Depth 4',
].join('; ')

type RawSys = {
  cpu?: number | null
  freeKB?: number
  totalKB?: number
  disks?: { id: string; free: number; size: number }[] | { id: string; free: number; size: number }
  tz?: number
  gpu?: { name: string; util: number; memUsedMB: number; memTotalMB: number; tempC: number } | null
}

const GB = 1024 ** 3

export function parseSys(stdout: string, now: number): SysSnap | null {
  const text = stdout.trim()
  if (!text) return null
  let raw: RawSys
  try {
    raw = JSON.parse(text) as RawSys
  } catch {
    return null
  }
  const totalKB = raw.totalKB ?? 0
  const freeKB = raw.freeKB ?? 0
  const list = raw.disks === undefined ? [] : Array.isArray(raw.disks) ? raw.disks : [raw.disks]

  return {
    cpu: typeof raw.cpu === 'number' ? Math.round(raw.cpu) : null,
    memTotalGB: (totalKB * 1024) / GB,
    memUsedGB: ((totalKB - freeKB) * 1024) / GB,
    disks: list.map(one => ({ id: one.id, freeGB: one.free / GB, sizeGB: one.size / GB })),
    tzOffsetMin: typeof raw.tz === 'number' ? raw.tz : 0,
    gpu:
      raw.gpu && Number.isFinite(raw.gpu.util)
        ? {
            name: raw.gpu.name,
            util: Math.round(raw.gpu.util),
            memUsedGB: raw.gpu.memUsedMB / 1024,
            memTotalGB: raw.gpu.memTotalMB / 1024,
            tempC: Number.isFinite(raw.gpu.tempC) ? Math.round(raw.gpu.tempC) : null,
          }
        : null,
    at: now,
  }
}

// ── Bar drawing ───────────────────────────────────────────────────────────

export const PALETTE = {
  accent: '#E07B53',
  blue: '#5B8DEF',
  violet: '#9B7BEA',
  teal: '#3FB6A8',
  orange: '#E8955A',
  green: '#6CC070',
  amber: '#E3B341',
  red: '#E5534B',
  ink: '#0B0D12',
  track: 'subtle',
} as const

export type Run = { text: string; color: string; backgroundColor?: string }

export function toneHex(percent: number): string {
  const t = tone(percent)
  if (t === 'error') return PALETTE.red
  if (t === 'warning') return PALETTE.amber

  return PALETTE.green
}

// Merges neighbouring cells of the same paint into one run.
function runsOf(cells: Run[]): Run[] {
  const out: Run[] = []
  for (const cell of cells) {
    const last = out[out.length - 1]
    if (last && last.color === cell.color && last.backgroundColor === cell.backgroundColor) {
      last.text += cell.text
    } else {
      out.push({ ...cell })
    }
  }

  return out
}

// Stacked bar: each part gets a share of `width` by largest remainder, and a
// non-zero part keeps at least one cell while there is room for it.
export function segmentBar(parts: { value: number; color: string }[], width: number): Run[] {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0)
  if (total <= 0 || width <= 0) return [{ text: '█'.repeat(Math.max(0, width)), color: PALETTE.track }]

  const exact = parts.map(p => (Math.max(0, p.value) / total) * width)
  const cells = exact.map(x => Math.floor(x))
  parts.forEach((p, i) => {
    if (p.value > 0 && cells[i] === 0) cells[i] = 1
  })
  let used = cells.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r)
  for (let k = 0; used < width && k < order.length * 2; k++) {
    const one = order[k % order.length]
    if (one && (parts[one.i]?.value ?? 0) > 0) {
      cells[one.i] = (cells[one.i] ?? 0) + 1
      used++
    }
  }
  while (used > width) {
    const widest = cells.indexOf(Math.max(...cells))
    cells[widest] = (cells[widest] ?? 1) - 1
    used--
  }

  return runsOf(parts.flatMap((p, i) => Array.from({ length: cells[i] ?? 0 }, () => ({ text: '█', color: p.color }))))
}

// Usage bar on a solid track, with an optional pace marker at the share of
// the window's time already elapsed.
export function paceBar(percent: number, elapsed: number | null, width: number, fill: string): Run[] {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width)
  const marker = elapsed === null ? -1 : Math.max(0, Math.min(width - 1, Math.round(elapsed * width)))
  const cells: Run[] = Array.from({ length: width }, (_, i) => {
    const under = i < filled ? fill : PALETTE.track
    if (i === marker) return { text: '┃', color: i < filled ? PALETTE.ink : 'text', backgroundColor: under }

    return { text: '█', color: under }
  })

  return runsOf(cells)
}

export function windowMs(kind: string): number | null {
  if (kind === 'five_hour') return 5 * 3_600_000
  if (kind === 'seven_day' || kind.startsWith('seven_day_')) return 7 * 86_400_000

  return null
}

export function elapsedShare(kind: string, resetsAt: string | undefined, now: number): number | null {
  const span = windowMs(kind)
  const at = resetsAt ? Date.parse(resetsAt) : Number.NaN
  if (span === null || Number.isNaN(at) || !now) return null

  return Math.max(0, Math.min(1, 1 - (at - now) / span))
}

export function fmtResetShort(iso: string | undefined, nowMs: number, tzOffsetMin: number): string {
  if (!iso) return 'reset unknown'
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return 'reset unknown'
  const withDate = at - nowMs > 20 * 3_600_000

  return `${fmtLocal(at, tzOffsetMin, withDate)} · in ${fmtDuration(at - nowMs)}`
}

// ── Vector bars (surfaces with Svg) ───────────────────────────────────────
// Drawn wider than the slot is likely to be so the surface scales them down
// to fit it; preserveAspectRatio="none" keeps the requested pixel height.

export const PX_PER_CELL = 8.5
export const SVG_TRACK = 'rgba(128,128,128,0.25)'

function svgFrame(width: number, height: number, body: string): string {
  const r = height / 2

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">` +
    `<defs><clipPath id="c"><rect x="0" y="0" width="${width}" height="${height}" rx="${r}" ry="${r}"/></clipPath></defs>` +
    `<g clip-path="url(#c)"><rect x="0" y="0" width="${width}" height="${height}" fill="${SVG_TRACK}"/>${body}</g></svg>`
  )
}

export function svgPace(percent: number, elapsed: number | null, cells: number, fill: string, height = 8): string {
  const width = Math.max(20, Math.round(cells * PX_PER_CELL))
  const filled = (Math.max(0, Math.min(100, percent)) / 100) * width
  let body = `<rect x="0" y="0" width="${filled.toFixed(1)}" height="${height}" fill="${fill}"/>`
  if (elapsed !== null) {
    const x = Math.max(1, Math.min(width - 3, elapsed * width - 1))
    body += `<rect x="${x.toFixed(1)}" y="0" width="2.5" height="${height}" fill="#FFFFFF" stroke="rgba(0,0,0,0.55)" stroke-width="0.8"/>`
  }

  return svgFrame(width, height, body)
}

export function svgStack(parts: { value: number; color: string }[], cells: number, height = 10): string {
  const width = Math.max(20, Math.round(cells * PX_PER_CELL))
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0)
  if (total <= 0) return svgFrame(width, height, '')
  const gap = 2
  let x = 0
  let body = ''
  for (const p of parts) {
    if (p.value <= 0) continue
    const w = Math.max(3, (p.value / total) * width)
    body += `<rect x="${x.toFixed(1)}" y="0" width="${Math.max(1, w - gap).toFixed(1)}" height="${height}" fill="${p.color}"/>`
    x += w
  }

  return svgFrame(width, height, body)
}

// Rows each layout needs, so the band steps down (full system card, then a
// slim one-row system card, then one line) when the slot above the prompt is too short.
export type Layout = 'cards' | 'slim' | 'compact'

export const SLIM_SYSTEM_ROWS = 3

export function cardRows(windowCount: number, perRow: number): number {
  const limits = 2 + 1 + 2 * Math.max(1, windowCount)
  const session = 2 + 1 + 1 + 2 + 1

  return perRow >= 2 ? Math.max(limits, session) : limits + session
}

// The system card: border, header, then two rows (label line + bar) per line of meters.
export function systemRows(meterCount: number, perLine: number): number {
  return 2 + 1 + 2 * Math.max(1, Math.ceil(meterCount / Math.max(1, perLine)))
}

export function pickLayout(top: number, system: number, maxRows: number): Layout {
  if (top + system <= maxRows) return 'cards'
  if (top + SLIM_SYSTEM_ROWS <= maxRows) return 'slim'

  return 'compact'
}
