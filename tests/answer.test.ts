import { describe, expect, test } from 'claude-code/testing'

import { compileAnswers, emptyResponse, parseExtraction, pickOption, setCustom, toggleMulti } from '../hooks/lib'

const EXTRACTED = JSON.stringify({
  questions: [
    {
      id: 'db',
      header: 'Database',
      question: 'Which database should we use?',
      options: [
        { label: 'PostgreSQL', description: 'Relational' },
        { label: 'SQLite', description: 'Embedded' },
      ],
    },
    { id: 'name', question: 'What should the service be called?', options: [] },
  ],
})

const PANE = {
  title: 'Answer',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

describe('lib', () => {
  test('parses fenced JSON and normalizes questions', () => {
    const qs = parseExtraction('Here:\n```json\n' + EXTRACTED + '\n```')
    expect(qs?.length).toBe(2)
    expect(qs?.[0]?.options.map(o => o.label)).toEqual(['PostgreSQL', 'SQLite'])
    expect(parseExtraction('not json')).toBe(null)
    expect(parseExtraction('{"questions":[{"question":"  "}]}')).toEqual([])
  })

  test('single, multi and custom answers compile; unanswered are omitted', () => {
    const qs = parseExtraction(EXTRACTED) ?? []
    let first = pickOption(emptyResponse(), 1)
    expect(first.selected).toEqual([1])
    first = setCustom(first, 'DuckDB')
    expect(first.selected).toEqual([])
    let multi = toggleMulti(emptyResponse())
    multi = pickOption(pickOption(multi, 1), 0)
    multi = setCustom(multi, 'Redis')
    expect(compileAnswers(qs, [multi, emptyResponse()])).toBe(
      'Q: Which database should we use?\nA: PostgreSQL, SQLite, Redis',
    )
  })
})

test('/answer extracts, answers in the pane and submits', async ($, on) => {
  let submitted = ''
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: 'Plan the service', toolUses: [] },
      { role: 'assistant' as const, text: 'Which database? And the name?', toolUses: [] },
    ],
  }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: EXTRACTED, usage: USAGE } }))
  on('prompt.submit', (_$, e) => {
    submitted = e.text
    return { text: e.text }
  })

  let isOpen = false
  on('ui.open', () => {
    isOpen = true
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => {
    isOpen = false
    return { value: undefined }
  })

  await $.command.run({
    command: 'answer',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(isOpen).toBe(true)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'answer', surface, component: 'Pane', props: PANE, requestId: 'answer' })
    expect((await ui.find({ type: 'Text', text: /Which database/ }))?.type).toBe('Text')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'answer', surface: 'terminal', component: 'Pane', props: PANE, requestId: 'answer' })
  await ui.press({ key: 'opt:0' })
  expect((await ui.find({ type: 'Text', text: /service be called/ }))?.type).toBe('Text')
  await ui.input({ key: 'custom:name', text: 'billing-api' })
  expect((await ui.find({ key: 'submit' }))?.type).toBe('Button')
  await ui.press({ key: 'submit' })

  expect(submitted).toBe(
    'I answered your questions in the following way:\n\n' +
      'Q: Which database should we use?\nA: PostgreSQL\n\n' +
      'Q: What should the service be called?\nA: billing-api',
  )
  expect(isOpen).toBe(false)
})
