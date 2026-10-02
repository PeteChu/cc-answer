import type { Register } from 'claude-code'

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

type Outcome = { answers: unknown } | { cancel: 'dismissed' | 'clarify' }

let round: AskQuestion[] | null = null
let outcome: Outcome | null = null

export const register: Register = (on, options) => {
  const model = typeof options.model === 'string' && options.model.trim() ? options.model.trim() : 'haiku'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'answer',
      description: "Answer the questions in Claude's last reply in the question dialog",
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
        return {
          text:
            got?.cancel === 'clarify'
              ? 'answer: cancelled. Tell Claude what you would like to clarify.'
              : 'answer: cancelled.',
        }
      }
      for (const q of batch) answers.push(answerFor(got.answers, q.question))
    }

    const text = compileAnswers(questions, answers)
    if (!text) return { text: 'answer: no answers provided.' }
    // Submitting waits for the session to be idle, which this command holds: submit once it returns.
    $.clock.after(0, () => void $.prompt.submit({ text: `${SUBMIT_PREFIX}\n\n${text}`, asUser: true }))
    return {}
  })
}
