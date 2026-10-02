import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { DEMO_QUESTIONS, DESIGNS, custom, parseRich, pick, startSession } from '../hooks/proto/model'

const BAND = (bodyColumns: number) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows: 30,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
})

const command = (args: string) => ({
  command: 'answer-prototype',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

function engine(on: On) {
  const logged: string[] = []
  on('ui.log', (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    logged.push(`toast: ${e.text}`)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('prompt.suggest', () => ({ isShown: true }))
  return logged
}

describe('model', () => {
  test('single picks advance, multi toggles, typed text picks by label or answers freely', () => {
    let s = startSession(1, DEMO_QUESTIONS, 'demo')
    s = pick(s, 1)
    expect(s.index).toBe(1)
    s = pick(pick(s, 0), 2)
    expect(s.responses[1]?.selected).toEqual([0, 2])
    expect(s.index).toBe(1)
    s = custom(s, 'Audit log')
    expect(s.index).toBe(2)
    s = custom(s, 'yes')
    expect(s.responses[2]?.selected).toEqual([0])
    s = custom(s, 'billing-api')
    expect(s.phase).toBe('review')
    expect(s.responses[3]?.custom).toBe('billing-api')
  })

  test('parses live extraction with descriptions and open questions', () => {
    const qs = parseRich(
      '{"questions":[{"question":"Name?","options":[]},{"question":"DB?","header":"Database engine","options":[{"label":"PG","description":"rel"}]}]}',
    )
    expect(qs?.map(q => [q.header, q.options.length])).toEqual([
      ['Q1', 0],
      ['Database eng', 1],
    ])
  })
})

test('/answer-prototype with no number lists the designs', async ($, on) => {
  engine(on)
  const out = await $.command.run(command(''))
  expect(out.text).toContain('Usage: /answer-prototype')
  expect(out.text).toContain(DESIGNS[9]!.name)
})

for (const [i, design] of DESIGNS.entries()) {
  const n = i + 1
  test(`design ${n} (${design.name}) draws above the prompt and runs the whole flow`, async ($, on) => {
    const logged = engine(on)

    for (const surface of ['terminal', 'desktop'] as const) {
      for (const cols of [60, 120]) {
        await $.command.run(command(String(n)))
        const ui = await $.ui.mount({ plugin: 'answer', surface, component: 'AbovePrompt', props: BAND(cols) })
        expect((await ui.find({ key: 'opt:0' }))?.type).toBe('Button')
        await ui.press({ key: 'opt:0' }) // Database: PostgreSQL, moves on
        await ui.press({ key: 'opt:1' }) // Features: toggle Export
        await ui.press({ key: 'opt:3' }) // Features: toggle Themes
        await ui.press({ key: 'next' }) // Done
        await ui.press({ key: 'opt:1' }) // Tests: No
        await ui.press({ key: 'next' }) // Name: skip
        expect((await ui.find({ key: 'submit' }))?.type).toBe('Button')
        await ui.press({ key: 'submit' })
        await ui.unmount()
      }
    }

    expect(logged.length).toBe(4)
    expect(logged[0]).toBe(
      `answer prototype ${n} (demo, not sent):\nI answered your questions in the following way:\n\n` +
        'Q: Which database should the service use?\nA: PostgreSQL\n\n' +
        'Q: Which features should ship in v1?\nA: Export, Themes\n\n' +
        'Q: Should I add integration tests now?\nA: No',
    )
  })
}

test('cancel clears the band', async ($, on) => {
  const logged = engine(on)
  await $.command.run(command('2'))
  const ui = await $.ui.mount({ plugin: 'answer', surface: 'terminal', component: 'AbovePrompt', props: BAND(100) })
  await ui.press({ key: 'cancel' })
  expect(logged).toEqual(['toast: answer: cancelled'])
  await ui.unmount()
  await expect(
    $.ui.mount({ plugin: 'answer', surface: 'terminal', component: 'AbovePrompt', props: BAND(100) }),
  ).rejects.toThrow()
})
