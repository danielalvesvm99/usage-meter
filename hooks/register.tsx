import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionRateLimit, SessionCost } from 'claude-code'

import type { SysSnap, TokenTotals, UsageSnap } from '../types'
import {
  PALETTE,
  SYS_SCRIPT,
  elapsedShare,
  fmtLocal,
  fmtResetShort,
  fmtTokens,
  fmtUsd,
  cardRows,
  paceBar,
  pickLayout,
  systemRows,
  parseSys,
  segmentBar,
  svgPace,
  svgStack,
  toneHex,
  windowLabel,
  windowOrder,
} from './format'
import type { Run } from './format'

const EMPTY_TOKENS: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }
const SAMPLE_MS = 15_000

const usage = atom({ plugin: 'usage-meter', key: 'usage' } as const, null)
const tokens = atom({ plugin: 'usage-meter', key: 'tokens' } as const, EMPTY_TOKENS)
const sys = atom({ plugin: 'usage-meter', key: 'sys' } as const, null)
const sysError = atom({ plugin: 'usage-meter', key: 'sysError' } as const, null)
const isHidden = atom({ plugin: 'usage-meter', key: 'isHidden' } as const, false)
const isCompact = atom({ plugin: 'usage-meter', key: 'isCompact' } as const, false)

function snapOf(rateLimits: SessionRateLimit[], cost: SessionCost | undefined, at: number): UsageSnap {
  return {
    windows: rateLimits
      .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
      .sort((a, b) => windowOrder(a.kind) - windowOrder(b.kind)),
    costUsd: cost?.usd,
    at,
  }
}

let isSampling = false

async function sample($: EngineInterface) {
  const now = await $.clock.now()
  const current = await $.session.usage()
  await update($, usage, () => snapOf(current.rateLimits, current.cost, now))

  if (isSampling) return
  isSampling = true
  try {
    const ran = await $.process.run(
      ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', SYS_SCRIPT],
      { timeoutMs: 20_000 },
    )
    const snap: SysSnap | null = ran.exitCode === 0 ? parseSys(ran.stdout, now) : null
    if (snap) {
      await update($, sys, () => snap)
      await update($, sysError, () => null)
    } else {
      await update($, sysError, () => (ran.stderr.trim().split('\n')[0] || 'no output').slice(0, 120))
    }
  } catch (error) {
    await update($, sysError, () => String(error).slice(0, 120))
  } finally {
    isSampling = false
  }
}

const pct = (n: number) => `${Math.round(n)}%`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-meter',
      description: 'Show or hide the usage meter band above the prompt',
    })
    void sample($)
    $.clock.every(SAMPLE_MS, () => void sample($))

    return next(e)
  })

  on('command.run', { command: 'usage-meter' }, async $ => {
    const hidden = await update($, isHidden, value => !value)

    return { text: hidden ? 'Usage meter hidden. Run /usage-meter to show it again.' : 'Usage meter shown.' }
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, usage, () => snapOf(e.rateLimits, e.cost, now))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const counted = e.usage
    if (counted) {
      await update($, tokens, total => ({
        input: total.input + counted.input_tokens,
        output: total.output + counted.output_tokens,
        cacheRead: total.cacheRead + counted.cache_read_input_tokens,
        cacheWrite: total.cacheWrite + counted.cache_creation_input_tokens,
        turns: total.turns + 1,
      }))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    // The terminal draws no Svg (and its table may still name one): bars there are text.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const snap = await read($, usage)
    const totals = await read($, tokens)
    const machine = await read($, sys)
    const machineError = await read($, sysError)

    const now = machine?.at ?? snap?.at ?? 0
    const tz = machine?.tzOffsetMin ?? 0
    const windows = snap?.windows ?? []
    const allTokens = totals.input + totals.output + totals.cacheRead + totals.cacheWrite
    const memPct = machine ? (machine.memUsedGB / Math.max(machine.memTotalGB, 0.001)) * 100 : 0
    const cols = Math.max(40, e.props.bodyColumns)
    const inner = Math.max(10, cols - 4)

    const machineMeters = machine
      ? [
          { label: 'cpu', value: machine.cpu ?? 0, detail: 'load' },
          { label: 'ram', value: memPct, detail: `${machine.memUsedGB.toFixed(1)} / ${machine.memTotalGB.toFixed(0)} GB` },
          ...(machine.gpu
            ? [
                {
                  label: 'gpu',
                  value: machine.gpu.util,
                  detail: `${machine.gpu.memUsedGB.toFixed(1)} GB${machine.gpu.tempC === null ? '' : ` · ${machine.gpu.tempC}°C`}`,
                },
              ]
            : []),
          ...machine.disks.map(d => ({
            label: d.id,
            value: 100 - (d.freeGB / Math.max(d.sizeGB, 0.001)) * 100,
            detail: `${d.freeGB.toFixed(0)} GB free`,
          })),
        ]
      : []

    // Layout: two cards above a full-width system card; stepping down to a
    // slim one-row system card, then to one line in all, when rows run short.
    const perRow = cols >= 86 ? 2 : 1
    const cardW = Math.floor((cols - (perRow - 1)) / perRow)
    const cardInner = Math.max(10, cardW - 4)
    const meterGap = 3
    const perLine = Math.max(1, Math.min(machineMeters.length || 1, Math.floor((inner + meterGap) / (18 + meterGap))))
    const meterW = Math.floor((inner - meterGap * (perLine - 1)) / perLine)
    const fitted = pickLayout(
      cardRows(windows.length, perRow),
      systemRows(machineMeters.length, perLine),
      e.props.maxRows,
    )
    const layout = (await read($, isCompact)) ? 'compact' : fitted

    const textBar = (runs: Run[]) =>
      runs.map(r => (
        <Text color={r.color} backgroundColor={r.backgroundColor}>
          {r.text}
        </Text>
      ))
    // One meter: an Svg sized to its box where the surface has one, cells of text otherwise.
    const meter = (value: number, elapsed: number | null, cells: number, label: string) =>
      Svg ? (
        <Box width={cells} height={1} alignItems="center">
          <Svg source={svgPace(value, elapsed, cells, toneHex(value))} alt={`${label}: ${pct(value)} used`} height={8} />
        </Box>
      ) : (
        <Box flexDirection="row">{textBar(paceBar(value, elapsed, cells, toneHex(value)))}</Box>
      )
    const pill = (text: string, bg: string) => (
      <Text backgroundColor={bg} color={PALETTE.ink} bold>
        {` ${text} `}
      </Text>
    )
    const diamond = <Text color={PALETTE.accent}>◆ </Text>
    const updated = now ? `updated ${fmtLocal(now, tz, false)}` : 'sampling…'

    const controls = (
      <Box flexDirection="row" gap={2} flexShrink={0}>
        <Button key="compact" plain label={layout === 'compact' ? 'expand' : 'compact'} onPress={() => update($, isCompact, v => !v)} />
        <Button key="hide" plain role="dismiss" label="hide" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )

    // A row of small inline meters: the compact band, and the slim system card.
    const inlineMeters = (items: { label: string; value: number; elapsed?: number | null }[]) =>
      items.map(m => (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text dimColor>{m.label}</Text>
          {meter(m.value, m.elapsed ?? null, 8, m.label)}
          <Text color={toneHex(m.value)} bold>
            {pct(m.value)}
          </Text>
        </Box>
      ))

    if (layout === 'compact') {
      return (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center" flexShrink={1}>
            <Box flexDirection="row">
              {diamond}
              <Text bold>usage</Text>
            </Box>
            {inlineMeters(
              windows.map(w => ({
                label: windowLabel(w.kind).toLowerCase(),
                value: w.percentUsed,
                elapsed: elapsedShare(w.kind, w.resetsAt, now),
              })),
            )}
            <Box flexDirection="row" gap={1}>
              <Text dimColor>tokens</Text>
              <Text bold>{fmtTokens(allTokens)}</Text>
              {snap?.costUsd !== undefined && <Text bold>{fmtUsd(snap.costUsd)}</Text>}
            </Box>
            {inlineMeters(machineMeters)}
          </Box>
          {controls}
        </Box>
      )
    }

    const header = (title: string, rest: string, right?: RenderChildren) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          {diamond}
          <Text bold>{title}</Text>
          <Text dimColor>{rest}</Text>
        </Box>
        {right}
      </Box>
    )
    const card = (key: string, width: number | string, children: RenderChildren[]) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} width={width} flexGrow={1}>
        {children}
      </Box>
    )
    // Label, value and detail on one line with the bar beneath: the row every card shares.
    const labelRow = (label: string, value: number, detail: string) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text>{`${label} `}</Text>
          <Text color={toneHex(value)} bold>
            {pct(value)}
          </Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          {detail}
        </Text>
      </Box>
    )

    const peak = windows.reduce((m, w) => Math.max(m, w.percentUsed), 0)
    const limitsCard = card('card-limits', cardW, [
      header(
        'plan limits',
        windows.length ? ' · tick = time elapsed' : '',
        windows.length ? pill(pct(peak), toneHex(peak)) : undefined,
      ),
      windows.length === 0 && <Text dimColor>no reading yet · shows after the next reply</Text>,
      ...windows.flatMap(w => [
        labelRow(windowLabel(w.kind), w.percentUsed, fmtResetShort(w.resetsAt, now, tz)),
        meter(w.percentUsed, elapsedShare(w.kind, w.resetsAt, now), cardInner, windowLabel(w.kind)),
      ]),
    ])

    const parts = [
      { label: 'cache read', value: totals.cacheRead, color: PALETTE.blue },
      { label: 'cache write', value: totals.cacheWrite, color: PALETTE.violet },
      { label: 'input', value: totals.input, color: PALETTE.teal },
      { label: 'output', value: totals.output, color: PALETTE.orange },
    ]
    const half = Math.floor(cardInner / 2)
    const legend = (p: (typeof parts)[number]) => (
      <Box flexDirection="row" width={half}>
        <Text color={p.color}>■ </Text>
        <Text>{`${p.label} `}</Text>
        <Text bold>{fmtTokens(p.value)}</Text>
        <Text dimColor>{` ${allTokens ? pct((p.value / allTokens) * 100) : '0%'}`}</Text>
      </Box>
    )
    const stack = Svg ? (
      <Box width={cardInner} height={1} alignItems="center">
        <Svg source={svgStack(parts, cardInner)} alt={`tokens: ${fmtTokens(allTokens)} in all`} height={10} />
      </Box>
    ) : (
      <Box flexDirection="row">{textBar(segmentBar(parts, cardInner))}</Box>
    )
    const sessionCard = card('card-session', cardW, [
      header(
        'tokens',
        ` ${fmtTokens(allTokens)} · ${totals.turns} turns`,
        snap?.costUsd !== undefined ? pill(fmtUsd(snap.costUsd), PALETTE.accent) : undefined,
      ),
      stack,
      <Box flexDirection="row">
        {legend(parts[0]!)}
        {legend(parts[1]!)}
      </Box>,
      <Box flexDirection="row">
        {legend(parts[2]!)}
        {legend(parts[3]!)}
      </Box>,
      <Text dimColor>spend ≈ API list price, not your plan bill</Text>,
    ])

    const machineBody = machine ? (
      <Box flexDirection="row" flexWrap="wrap" columnGap={meterGap}>
        {machineMeters.map(m => (
          <Box flexDirection="column" width={meterW}>
            {labelRow(m.label, m.value, m.detail)}
            {meter(m.value, null, meterW, m.label)}
          </Box>
        ))}
      </Box>
    ) : (
      <Text dimColor>{machineError ? `unavailable: ${machineError}` : 'sampling…'}</Text>
    )
    const systemCard = card('card-system', '100%', [header('system', ` · ${updated}`, controls), machineBody])

    // The same card on one row of inline meters, for a slot too short for the full one.
    const systemSlim = (
      <Box key="card-system-slim" flexDirection="row" justifyContent="space-between" alignItems="center" borderStyle="round" borderColor="subtle" paddingX={1} width="100%">
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center" flexShrink={1}>
          <Box flexDirection="row">
            {diamond}
            <Text bold>system</Text>
          </Box>
          {machine ? inlineMeters(machineMeters) : <Text dimColor>{machineError ? `unavailable: ${machineError}` : 'sampling…'}</Text>}
        </Box>
        <Box flexDirection="row" gap={2} flexShrink={0}>
          <Text dimColor>{updated}</Text>
          {controls}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {limitsCard}
          {sessionCard}
        </Box>
        {layout === 'cards' ? systemCard : systemSlim}
      </Box>
    )
  })
}
