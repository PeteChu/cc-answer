import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { answerFor, batches, compileAnswers, parseExtraction, repairJson } from '../hooks/lib.mjs'

const opts = (...labels: string[]) => labels.map(label => ({ label, description: `${label} option` }))

const EXTRACTED = JSON.stringify({
  questions: [
    { question: 'Which database should we use?', header: 'Database choice', options: opts('PostgreSQL', 'SQLite') },
    {
      question: 'Which features ship in v1?',
      header: 'Features',
      multiSelect: true,
      options: opts('Search', 'Export', 'Other', 'Sharing', 'Themes', 'Extra'),
    },
    { question: 'Add integration tests now?', header: 'Tests', options: ['Yes', 'No'] },
    { question: 'What should the service be called?', header: 'Name', options: [] },
    { question: 'Where should it be deployed?', header: 'Deploy', options: opts('Fly.io', 'AWS') },
  ],
})

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const COMMAND = {
  command: 'answer',
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
}
const ANSWERS: Record<string, string> = {
  'Which database should we use?': 'PostgreSQL',
  'Which features ship in v1?': 'Search, Sharing, Audit log',
  'What should the service be called?': 'billing-api',
  'Where should it be deployed?': 'AWS',
}

function engine(on: On, replies: string[] = [EXTRACTED], logged: string[] = []) {
  on('session.messages', () => ({ value: [{ role: 'assistant' as const, text: 'Five questions…', toolUses: [] }] }))
  let call = 0
  on('model.complete', () => {
    const text = replies[Math.min(call++, replies.length - 1)] as string
    return { value: { isAnswered: true as const, text, usage: USAGE } }
  })
  on('ui.log', (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  return submitted
}

describe('lib', () => {
  test('normalizes to what the native dialog accepts', () => {
    const qs = parseExtraction('```json\n' + EXTRACTED + '\n```') ?? []
    expect(qs.length).toBe(5)
    expect(qs[0]?.header).toBe('Database cho')
    expect(qs[1]?.options.map(o => o.label)).toEqual(['Search', 'Export', 'Sharing', 'Themes'])
    expect(qs[1]?.options[0]?.description).toBe('Search option')
    expect(qs[3]?.options.map(o => o.label)).toEqual(['No preference', 'Not sure yet'])
    expect(batches(qs).map(b => b.length)).toEqual([4, 1])
    expect(parseExtraction('not json')).toBe(null)
  })

  test('reads replies models commonly get wrong', () => {
    const q = (n: number) =>
      `{ "question": "Question ${n}?", "header": "Q${n}", "options": [{ "label": "A" }, { "label": "B" }] }`
    // Cut off mid-way, inside an unclosed fence: the whole questions survive.
    const truncated =
      '```json\n{ "questions": [' + q(1) + ', ' + q(2) + ', { "question": "Question 3?", "options": [{ "lab'
    expect(parseExtraction(truncated)?.map(one => one.question)).toEqual(['Question 1?', 'Question 2?'])
    // Prose around the object, trailing commas, a raw newline and smart quotes.
    const messy =
      'Sure! Here you go:\n{ \u201cquestions\u201d: [{ "question": "Pick\none?", "options": ["A", "B",], },], }\nHope that helps.'
    expect(parseExtraction(messy)?.map(one => one.question)).toEqual(['Pick one?'])
    expect(repairJson('{"a": "x\ny", "b": [1, 2,],}')).toBe('{"a": "x\\ny", "b": [1, 2]}')
    expect(parseExtraction('{"questions": []}')).toEqual([])
    expect(parseExtraction('There are no questions in this reply.')).toBe(null)
  })

  test('reads answers and compiles answered questions only', () => {
    const qs = parseExtraction(EXTRACTED) ?? []
    expect(answerFor({ 'Add integration tests now?': ['Yes', ' No '] }, 'Add integration tests now?')).toBe('Yes, No')
    expect(compileAnswers(qs.slice(2, 4), ['', 'billing-api'])).toBe(
      'Q: What should the service be called?\nA: billing-api',
    )
  })
})

test('/answer opens the native dialog with every question, in rounds of four, then submits', async ($, on) => {
  const submitted = engine(on)
  const rounds: unknown[][] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    rounds.push(e.questions)
    const answers = Object.fromEntries(
      e.questions.flatMap(q => (ANSWERS[q.question] ? [[q.question, ANSWERS[q.question]]] : [])),
    )
    return { result: { questions: e.questions, answers } }
  })

  const clock = mock.clock(on)
  const out = await $.command.run(COMMAND)
  await clock.advance(0)

  expect(out.text).toBe(undefined)
  expect(rounds.map(r => r.length)).toEqual([4, 1])
  expect(rounds[0]?.[1]).toMatchObject({ header: 'Features', multiSelect: true })
  expect(submitted).toEqual([
    'I answered your questions in the following way:\n\n' +
      'Q: Which database should we use?\nA: PostgreSQL\n\n' +
      'Q: Which features ship in v1?\nA: Search, Sharing, Audit log\n\n' +
      'Q: What should the service be called?\nA: billing-api\n\n' +
      'Q: Where should it be deployed?\nA: AWS',
  ])
})

for (const [how, text, expected] of [
  ['Esc', "The user doesn't want to proceed with this tool use.", 'cancelled.'],
  [
    'Chat about this',
    'The user wants to clarify these questions.',
    'cancelled. Tell Claude what you would like to clarify.',
  ],
] as const) {
  test(`${how} in the dialog cancels without submitting`, async ($, on) => {
    const submitted = engine(on)
    let calls = 0
    on('tool.call', { tool: 'AskUserQuestion' }, () => {
      calls += 1
      return { result: `Error: ${text}`, text, isError: true }
    })

    const out = await $.command.run(COMMAND)

    expect(out.text).toBe(expected)
    expect(calls).toBe(1)
    expect(submitted).toEqual([])
  })
}

test('an unreadable first reply is retried once with a stricter instruction', async ($, on) => {
  const submitted = engine(on, ['Here are the questions: 1. Database? 2. Name?', EXTRACTED])
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => ({ result: { questions: e.questions, answers: ANSWERS } }))
  const clock = mock.clock(on)

  const out = await $.command.run(COMMAND)
  await clock.advance(0)

  expect(out.text).toBe(undefined)
  expect(submitted.length).toBe(1)
})

test('when both replies are unreadable, the message shows what the model said', async ($, on) => {
  engine(on, ['I could not find any JSON-worthy questions, sorry.'])
  const out = await $.command.run(COMMAND)
  expect(out.text).toBe(
    'haiku did not return the questions as JSON. It replied: "I could not find any JSON-worthy questions, sorry." (50 chars)',
  )
})

test('/answer --debug ends with the raw replies and the parsed questions', async ($, on) => {
  engine(on, ['nope', EXTRACTED])
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: 'Error: dismissed', text: 'dismissed', isError: true }))

  const out = await $.command.run({ ...COMMAND, args: '--debug' })

  expect(out.text?.startsWith('cancelled.\n\nanswer --debug · model haiku')).toBe(true)
  expect(out.text).toContain('── raw reply ──\n4 chars\nnope')
  expect(out.text).toContain('── retry (first reply did not parse) ──')
  expect(out.text).toContain('2. [Features] (multi-select) Which features ship in v1?')
  expect(out.text).toContain('     - Search — Search option')
})

test('/answer --debug shows the report even when extraction fails', async ($, on) => {
  engine(on, ['no json here'])
  const out = await $.command.run({ ...COMMAND, args: '--debug' })
  expect(out.text).toContain('── parsed ──\nnothing: no "questions" array could be read')
})
