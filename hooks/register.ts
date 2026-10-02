import type { Register } from 'claude-code'

import { SUBMIT_PREFIX, SYSTEM_PROMPT, compileAnswers, parseExtraction } from './lib'

export const register: Register = (on, options) => {
  const model = typeof options.model === 'string' && options.model.trim() ? options.model.trim() : 'haiku'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'answer',
      description: "Answer the questions in Claude's last reply with the question dialog",
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
}
