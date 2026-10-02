import { describe, expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { compileAnswers, parseExtraction } from '../hooks/lib'

const EXTRACTED = JSON.stringify({
  questions: [
    {
      question: 'Which features should ship first?',
      header: 'Feature selection',
      multiSelect: true,
      options: [{ label: 'Search' }, 'Export', 'Search', 'Other (type it)', 'Sharing', 'Themes', 'Extra'],
    },
    { question: 'What should the service be called?', options: [] },
    { question: '   ', options: ['Yes', 'No'] },
  ],
})

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const COMMAND = {
  command: 'answer',
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
}

describe('lib', () => {
  test('normalizes to what the question dialog accepts', () => {
    const qs = parseExtraction('Here:\n```json\n' + EXTRACTED + '\n```') ?? []
    expect(qs).toEqual([
      {
        question: 'Which features should ship first?',
        header: 'Feature sele',
        options: ['Search', 'Export', 'Sharing', 'Themes'],
        multiSelect: true,
      },
      {
        question: 'What should the service be called?',
        header: 'Q2',
        options: ['No preference', 'Not sure yet'],
        multiSelect: false,
      },
    ])
    expect(parseExtraction('not json')).toBe(null)
  })

  test('compiles answered questions only', () => {
    const qs = parseExtraction(EXTRACTED) ?? []
    expect(compileAnswers(qs, ['', 'billing-api'])).toBe('Q: What should the service be called?\nA: billing-api')
  })
})

function engine(on: On) {
  on('session.messages', () => ({ value: [{ role: 'assistant' as const, text: 'A few questions…', toolUses: [] }] }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: EXTRACTED, usage: USAGE } }))
  on('ui.status', () => ({ value: undefined }))
}

test('/answer asks each question in the native dialog and submits', async ($, on) => {
  engine(on)
  const asked: unknown[] = []
  let submitted = ''
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    asked.push(e.questions)
    const q = e.questions[0]!
    const answer = q.multiSelect ? 'Search, Sharing' : 'billing-api'
    return { result: { questions: e.questions, answers: { [q.question]: answer } } }
  })
  on('prompt.submit', (_$, e) => {
    submitted = e.text
    return { text: e.text }
  })

  const clock = mock.clock(on)
  const out = await $.command.run(COMMAND)
  await clock.advance(0)

  expect(out.text).toBe(undefined)
  expect(asked.length).toBe(2)
  expect(submitted).toBe(
    'I answered your questions in the following way:\n\n' +
      'Q: Which features should ship first?\nA: Search, Sharing\n\n' +
      'Q: What should the service be called?\nA: billing-api',
  )
})

test('dismissing the dialog cancels without submitting', async ($, on) => {
  engine(on)
  let isSubmitted = false
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'dismissed' }))
  on('prompt.submit', (_$, e) => {
    isSubmitted = true
    return { text: e.text }
  })

  const out = await $.command.run(COMMAND)

  expect(out.text).toBe('answer: cancelled after 0 of 2 questions.')
  expect(isSubmitted).toBe(false)
})
