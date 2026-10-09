import { describe, expect, test } from 'claude-code/testing'

import { PALETTE, bar, cardRows, elapsedShare, fmtReset, fmtTokens, paceBar, parseSys, pickLayout, segmentBar, systemRows, tone, windowLabel } from './format'

describe('usage bars', () => {
  test('fills the bar in proportion and clamps past 100', async () => {
    expect(bar(50, 10)).toBe('█████░░░░░')
    expect(bar(0, 4)).toBe('░░░░')
    expect(bar(130, 4)).toBe('████')
  })

  test('turns warning at 60% and error at 85%', async () => {
    expect(tone(59)).toBe('success')
    expect(tone(60)).toBe('warning')
    expect(tone(85)).toBe('error')
  })

  test('names the windows, a per-model weekly cap included', async () => {
    expect(windowLabel('five_hour')).toBe('5-hour')
    expect(windowLabel('seven_day')).toBe('Weekly')
    expect(windowLabel('seven_day_fable')).toBe('Weekly Fable')
  })
})

describe('reset dates', () => {
  const now = Date.parse('2026-10-08T12:00:00Z')

  test('shows a near reset as a time and a countdown, in local time', async () => {
    // UTC-7: 13:30Z is 6:30 AM local
    expect(fmtReset('2026-10-08T13:30:00Z', now, -420)).toBe('resets 6:30 AM (in 1h 30m)')
  })

  test('shows a far reset with its date', async () => {
    expect(fmtReset('2026-10-12T16:00:00Z', now, 0)).toBe('resets Mon Oct 12, 4:00 PM (in 4d 4h)')
  })

  test('says when the reset is unknown', async () => {
    expect(fmtReset(undefined, now, 0)).toBe('reset time unknown')
  })
})

describe('tokens and system sample', () => {
  test('abbreviates token counts', async () => {
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(45_300)).toBe('45.3k')
    expect(fmtTokens(1_234_567)).toBe('1.23M')
  })

  test('parses the PowerShell sample, a single disk included', async () => {
    const out = JSON.stringify({
      cpu: 23.4,
      freeKB: 8 * 1024 * 1024,
      totalKB: 32 * 1024 * 1024,
      disks: { id: 'C:', free: 120 * 1024 ** 3, size: 476 * 1024 ** 3 },
      tz: -420,
    })
    const snap = parseSys(out, 1)
    expect(snap?.cpu).toBe(23)
    expect(snap?.memUsedGB).toBe(24)
    expect(snap?.disks).toEqual([{ id: 'C:', freeGB: 120, sizeGB: 476 }])
    expect(snap?.tzOffsetMin).toBe(-420)
  })

  test('reads the GPU when nvidia-smi answered, and none when it did not', async () => {
    const base = { cpu: 1, freeKB: 1, totalKB: 2, disks: [], tz: 0 }
    const withGpu = parseSys(
      JSON.stringify({ ...base, gpu: { name: 'GTX 1080', util: 37.6, memUsedMB: 2048, memTotalMB: 8192, tempC: 57 } }),
      1,
    )
    expect(withGpu?.gpu).toEqual({ name: 'GTX 1080', util: 38, memUsedGB: 2, memTotalGB: 8, tempC: 57 })
    expect(parseSys(JSON.stringify({ ...base, gpu: null }), 1)?.gpu).toBeNull()
  })

  test('returns null on output that is not JSON', async () => {
    expect(parseSys('Get-CimInstance : Access denied', 1)).toBeNull()
  })
})

describe('modern bars', () => {
  const width = (runs: { text: string }[]) => runs.reduce((n, r) => n + r.text.length, 0)

  test('a stacked bar fills its width and keeps a sliver for a tiny part', async () => {
    const runs = segmentBar(
      [
        { value: 1_000_000, color: 'a' },
        { value: 10, color: 'b' },
        { value: 0, color: 'c' },
      ],
      30,
    )
    expect(width(runs)).toBe(30)
    expect(runs.map(r => r.color)).toEqual(['a', 'b'])
  })

  test('an empty stacked bar is all track', async () => {
    expect(segmentBar([{ value: 0, color: 'a' }], 8)).toEqual([{ text: '████████', color: PALETTE.track }])
  })

  test('a pace bar marks elapsed time over the fill', async () => {
    const runs = paceBar(50, 0.2, 10, 'fill')
    expect(width(runs)).toBe(10)
    expect(runs[1]).toEqual({ text: '┃', color: PALETTE.ink, backgroundColor: 'fill' })
  })

  test('elapsed share of a 5-hour window', async () => {
    const now = Date.parse('2026-10-08T12:00:00Z')
    expect(elapsedShare('five_hour', '2026-10-08T13:00:00Z', now)).toBe(0.8)
    expect(elapsedShare('spend_limit', '2026-10-08T13:00:00Z', now)).toBeNull()
  })
})

describe('layout steps', () => {
  test('cards with the full system card when it fits, then a slim one, then one line', async () => {
    const top = cardRows(2, 2)
    const system = systemRows(5, 5)
    expect(top).toBe(7)
    expect(system).toBe(5)
    expect(pickLayout(top, system, 12)).toBe('cards')
    expect(pickLayout(top, system, 10)).toBe('slim')
    expect(pickLayout(top, system, 9)).toBe('compact')
  })

  test('meters that do not fit one line take another', async () => {
    expect(systemRows(5, 3)).toBe(7)
  })
})
