import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ProtoSession } from '../types'
import { SUBMIT_PREFIX, SYSTEM_PROMPT, compileAnswers, parseExtraction } from './lib'
import { drawDesign } from './proto/designs'
import {
  DEMO_QUESTIONS,
  DESIGNS,
  RICH_PROMPT,
  answerText,
  back,
  compile,
  custom,
  goTo,
  next as nextQuestion,
  parseRich,
  pick,
  startSession,
} from './proto/model'

const proto = atom({ plugin: 'answer', key: 'proto' } as const, null)

/** Design 9 mirrors the current pick (or the first option) as ghost text in the prompt box. */
async function suggest($: EngineInterface) {
  const s = await read($, proto)
  if (!s || s.design !== 9 || s.phase !== 'answering') return
  const q = s.questions[s.index]
  const text = q ? answerText(q, s.responses[s.index]) || q.options[0]?.label : undefined
  if (text) await $.prompt.suggest({ text })
}

async function apply($: EngineInterface, fn: (s: ProtoSession) => ProtoSession) {
  await update($, proto, s => (s ? fn(s) : s))
  await suggest($)
}

async function cancel($: EngineInterface) {
  await update($, proto, () => null)
  $.ui.toast('answer: cancelled')
}

async function submit($: EngineInterface) {
  const s = await read($, proto)
  if (!s) return
  const text = compile(s)
  await update($, proto, () => null)
  if (!text) {
    $.ui.toast('answer: no answers provided')
    return
  }
  const prompt = `${SUBMIT_PREFIX}\n\n${text}`
  // Demo questions are not Claude's: show what would be sent instead of sending it.
  if (s.source === 'demo') $.ui.log(`answer prototype ${s.design} (demo, not sent):\n${prompt}`)
  else await $.prompt.submit({ text: prompt, asUser: true })
}

const LISTING = [
  'Usage: /answer-prototype <1-10> [live]',
  '  demo questions by default; "live" extracts them from Claude\'s last reply and really submits',
  '',
  ...DESIGNS.map((d, i) => `  ${String(i + 1).padStart(2)}  ${d.name.padEnd(18)} ${d.blurb}`),
  '',
  'Every design: 1-7 pick · type in the prompt + Enter for your own answer · 8 back · 9 skip/done · 0 cancel',
].join('\n')

export const register: Register = (on, options) => {
  const model = typeof options.model === 'string' && options.model.trim() ? options.model.trim() : 'haiku'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'answer',
      description: "Answer the questions in Claude's last reply with the question dialog",
    })
    await $.command.register({
      name: 'answer-prototype',
      description: 'Try a prototype answer UI above the prompt: /answer-prototype <1-10> [live]',
    })
    return next(e)
  })

  on('command.run', { command: 'answer' }, async $ => {
    const messages = await $.session.messages()
    const last = [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim().length > 0)
    if (!last) return { text: 'answer: no assistant reply with text to answer yet.' }

    $.ui.status(`answer: extracting questions with ${model}…`)
    const reply = await $.model.complete({
      model,
      system: SYSTEM_PROMPT,
      prompt: last.text,
      maxTokens: 4096,
      effort: 'low',
      timeoutMs: 120_000,
    })
    $.ui.status(undefined)
    if (!reply.isAnswered) return { text: `answer: extraction failed (${reply.reason}).` }

    const questions = parseExtraction(reply.text)
    if (questions === null) return { text: 'answer: the extraction model did not return valid JSON.' }
    if (questions.length === 0) return { text: 'answer: no questions found in the last reply.' }

    // Each question opens the engine's own AskUserQuestion dialog; its "Other" takes free text.
    const answers: string[] = []
    for (const q of questions) {
      try {
        answers.push(
          await $.ui.ask(q.question, {
            options: q.options,
            header: q.header,
            ...(q.multiSelect ? { multiSelect: true as const } : {}),
          }),
        )
      } catch {
        return { text: `answer: cancelled after ${answers.length} of ${questions.length} questions.` }
      }
    }

    const text = compileAnswers(questions, answers)
    if (!text) return { text: 'answer: no answers provided.' }
    // Submitting waits for the session to be idle, which this command holds: submit once it returns.
    $.clock.after(0, () => void $.prompt.submit({ text: `${SUBMIT_PREFIX}\n\n${text}`, asUser: true }))
    return {}
  })

  on('command.run', { command: 'answer-prototype' }, async ($, e) => {
    const [first = '', mode = ''] = e.args.trim().split(/\s+/)
    const design = Number(first)
    if (!Number.isInteger(design) || design < 1 || design > DESIGNS.length) return { text: LISTING }

    let questions = DEMO_QUESTIONS
    if (mode === 'live') {
      const messages = await $.session.messages()
      const last = [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim().length > 0)
      if (!last) return { text: 'answer: no assistant reply with text to answer yet.' }
      $.ui.status(`answer: extracting questions with ${model}…`)
      const reply = await $.model.complete({
        model,
        system: RICH_PROMPT,
        prompt: last.text,
        maxTokens: 4096,
        effort: 'low',
        timeoutMs: 120_000,
      })
      $.ui.status(undefined)
      if (!reply.isAnswered) return { text: `answer: extraction failed (${reply.reason}).` }
      const found = parseRich(reply.text)
      if (!found?.length) return { text: 'answer: no questions found in the last reply.' }
      questions = found
    }

    await update($, proto, () => startSession(design, questions, mode === 'live' ? 'live' : 'demo'))
    await suggest($)
    const name = DESIGNS[design - 1]?.name ?? ''
    return {
      text: `answer prototype ${design} · ${name}${mode === 'live' ? '' : ' (demo questions)'} — above the prompt: 1-7 pick, type + Enter for your own, 8 back, 9 skip, 0 cancel`,
    }
  })

  // While a prototype is up, a typed prompt answers the current question instead of going to Claude.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' || e.text.trim().startsWith('/')) return next(e)
    const s = await read($, proto)
    if (!s) return next(e)
    if (s.phase === 'review') return { drop: 'answer: 1 submits, 8 goes back, 0 cancels' }
    const header = s.questions[s.index]?.header ?? 'answer'
    await apply($, one => custom(one, e.text))
    return { drop: `answer · ${header}: ${e.text.trim()}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const s = await read($, proto)
    if (!s) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return drawDesign({
      E: { Box, Text, Button },
      s,
      cols: e.props.bodyColumns,
      act: {
        pick: option => void apply($, one => pick(one, option)),
        next: () => void apply($, nextQuestion),
        back: () => void apply($, back),
        goTo: index => void apply($, one => goTo(one, index)),
        cancel: () => void cancel($),
        submit: () => void submit($),
      },
    })
  })
}
