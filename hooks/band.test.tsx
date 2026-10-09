import { expect, test } from 'claude-code/testing'

const props = (bodyColumns: number, maxRows = 30) =>
  ({
    hasSurvey: false,
    isWorking: false,
    maxRows,
    bodyColumns,
    scroll: { bodyRows: maxRows, top: 0, rows: maxRows },
    view: {},
  }) as never

test('the band draws three cards on every surface and width, and compacts', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const width of [70, 100, 150]) {
      const ui = await $.ui.mount({ plugin: 'usage-meter', surface, component: 'AbovePrompt', props: props(width) })
      expect(await ui.find({ text: /plan limits/ })).toBeDefined()
      expect(await ui.find({ text: /tokens/ })).toBeDefined()
      expect(await ui.find({ text: /^system$/ })).toBeDefined()
      await ui.press({ key: 'compact' })
      expect(await ui.find({ text: /plan limits/ })).toBeUndefined()
      expect(await ui.find({ key: 'compact' })).toBeDefined()
      await ui.press({ key: 'compact' })
      await ui.unmount()
    }
  }
})

test('the desktop draws its bars as Svg, the terminal as text', async $ => {
  const desk = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'AbovePrompt', props: props(110) })
  expect((await desk.findAll({ type: 'Svg' })).length).toBeGreaterThan(0)
  await desk.unmount()
  const term = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', component: 'AbovePrompt', props: props(110) })
  expect(await term.find({ text: /█/ })).toBeDefined()
  await term.unmount()
})

test('a shorter slot keeps every card bordered, a tiny one falls to one line', async $ => {
  const full = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'AbovePrompt', props: props(110, 12) })
  expect(await full.find({ key: 'card-system' })).toBeDefined()
  await full.unmount()
  const slim = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'AbovePrompt', props: props(110, 10) })
  expect(await slim.find({ text: /plan limits/ })).toBeDefined()
  expect(await slim.find({ key: 'card-system-slim' })).toBeDefined()
  expect(await slim.find({ key: 'card-system' })).toBeUndefined()
  await slim.unmount()
  const tiny = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'AbovePrompt', props: props(110, 4) })
  expect(await tiny.find({ text: /plan limits/ })).toBeUndefined()
  expect(await tiny.find({ text: /usage/ })).toBeDefined()
  await tiny.unmount()
})
