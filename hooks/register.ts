import type { EngineInterface, Register } from 'claude-code'

import type { AskQuestion } from './lib'
import { SUBMIT_PREFIX, SYSTEM_PROMPT, answerFor, batches, compileAnswers, parseExtraction } from './lib'

/**
 * `$.ui.ask` opens the engine's own AskUserQuestion dialog but takes a single
 * question of bare labels. This plugin's `tool.call` hook sees that call and
 * swaps in a whole round of extracted questions, so the native dialog draws
 * them as tabs with descriptions, multi-select, "Type something" and its own
 * review screen. The placeholder question is how the hook knows the call is ours.
 */
const PLACEHOLDER = "Answer Claude's questions?"

const LIMITS = { maxTokens: 8192, effort: 'low', timeoutMs: 120_000 } as const
const STRICT =
  'Your reply must be exactly one JSON object and nothing else: no prose, no code fences, no commentary. Escape quotes and newlines inside strings.'

/** The start of a reply, on one line, for an error message. */
const snippet = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line ? `"${line.length > 160 ? `${line.slice(0, 160)}…` : line}" (${text.length} chars)` : '(empty)'
}

type Reply = Awaited<ReturnType<EngineInterface['model']['complete']>>

/** What `/answer --debug` prints before the dialog: the model, its raw reply per attempt, and what was parsed. */
function debugReport(
  model: string,
  input: string,
  first: Reply,
  retry: Reply,
  questions: AskQuestion[] | null,
): string {
  const raw = (r: Reply) => (r.isAnswered ? `${r.text.length} chars\n${r.text}` : `no reply (${r.reason})`)
  const lines = [
    `answer --debug · model ${model} · last reply ${input.length} chars`,
    '',
    '── raw reply ──',
    raw(first),
  ]
  if (retry !== first) lines.push('', '── retry (first reply did not parse) ──', raw(retry))
  lines.push('', '── parsed ──')
  if (questions === null) lines.push('nothing: no "questions" array could be read')
  else if (questions.length === 0) lines.push('no questions')
  for (const [i, q] of (questions ?? []).entries()) {
    lines.push(`${i + 1}. [${q.header}]${q.multiSelect ? ' (multi-select)' : ''} ${q.question}`)
    for (const o of q.options) lines.push(`     - ${o.label}${o.description ? ` — ${o.description}` : ''}`)
  }
  return lines.join('\n')
}

type Outcome = { answers: unknown } | { cancel: 'dismissed' | 'clarify' }

let round: AskQuestion[] | null = null
let outcome: Outcome | null = null

export const register: Register = (on, options) => {
  const model = typeof options.model === 'string' && options.model.trim() ? options.model.trim() : 'haiku'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'answer',
      description: "Answer the questions in Claude's last reply in the question dialog (--debug shows the extraction)",
    })
    return next(e)
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = round
    // Claude's own questions, and anything else not opened by /answer, pass untouched.
    if (!questions || e.questions[0]?.question !== PLACEHOLDER) return next(e)
    round = null
    const ran = await next({ ...e, questions })
    const result: unknown = ran.result
    if (!ran.isError && result && typeof result === 'object' && 'answers' in result) {
      outcome = { answers: result.answers }
    } else {
      // Esc rejects the call; "Chat about this" rejects it asking to clarify.
      outcome = { cancel: /clarify/i.test(ran.text ?? '') ? 'clarify' : 'dismissed' }
    }
    return ran
  })

  on('command.run', { command: 'answer' }, async ($, e) => {
    const isDebug = /(^|\s)--debug(\s|$)/.test(e.args)
    const messages = await $.session.messages()
    const last = [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim().length > 0)
    if (!last) return { text: 'no assistant reply with text to answer yet.' }

    $.ui.status(`extracting questions with ${model}…`)
    const first = await $.model.complete({ model, system: SYSTEM_PROMPT, prompt: last.text, ...LIMITS })
    let questions = first.isAnswered ? parseExtraction(first.text) : null
    let reply = first
    if (first.isAnswered && questions === null) {
      // One retry with a stricter instruction and more room: the usual failure is prose or a reply cut short.
      reply = await $.model.complete({
        model,
        system: `${SYSTEM_PROMPT}\n\n${STRICT}`,
        prompt: last.text,
        ...LIMITS,
        maxTokens: 16_000,
      })
      questions = reply.isAnswered ? parseExtraction(reply.text) : null
    }
    $.ui.status(undefined)
    // With --debug, every way out of the command ends with the extraction report.
    const report = isDebug ? debugReport(model, last.text, first, reply, questions) : ''
    const done = (text?: string) => {
      const out = [text, report].filter(Boolean).join('\n\n')
      return out ? { text: out } : {}
    }
    if (!reply.isAnswered) return done(`extraction with ${model} failed (${reply.reason}).`)
    if (questions === null) {
      $.ui.log(`extraction reply from ${model}:\n${reply.text}`, { to: 'debug' })
      return done(`${model} did not return the questions as JSON. It replied: ${snippet(reply.text)}`)
    }
    if (questions.length === 0) return done('no questions found in the last reply.')

    // The dialog holds up to four questions; more come as further rounds.
    const answers: string[] = []
    for (const batch of batches(questions)) {
      round = batch
      outcome = null
      try {
        await $.ui.ask(PLACEHOLDER, { options: ['Answer', 'Cancel'], header: 'Answer' })
      } catch {
        // The placeholder itself is never answered, so the ask rejects; the hook kept the outcome.
      }
      round = null
      // Set by the tool.call hook while the ask ran; the cast undoes the narrowing to the null set above.
      const got = outcome as Outcome | null
      if (!got || 'cancel' in got) {
        return done(got?.cancel === 'clarify' ? 'cancelled. Tell Claude what you would like to clarify.' : 'cancelled.')
      }
      for (const q of batch) answers.push(answerFor(got.answers, q.question))
    }

    const text = compileAnswers(questions, answers)
    if (!text) return done('no answers provided.')
    // Submitting waits for the session to be idle, which this command holds: submit once it returns.
    $.clock.after(0, () => void $.prompt.submit({ text: `${SUBMIT_PREFIX}\n\n${text}`, asUser: true }))
    return done()
  })
}
