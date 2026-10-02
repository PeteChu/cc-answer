import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AnswerResponse, AnswerSession } from '../types'
import {
  SUBMIT_PREFIX,
  SYSTEM_PROMPT,
  compileAnswers,
  emptyResponse,
  formatAnswer,
  isAnswered,
  parseExtraction,
  pickOption,
  setCustom,
  toggleMulti,
} from './lib'

const PANE = 'answer'
const TITLE = 'Answer'
const session = atom({ plugin: 'answer', key: 'session' } as const, null)

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })

const edit = ($: EngineInterface, fn: (s: AnswerSession) => AnswerSession) => update($, session, s => (s ? fn(s) : s))

const editResponse = ($: EngineInterface, fn: (r: AnswerResponse) => AnswerResponse) =>
  edit($, s => ({
    ...s,
    responses: s.responses.map((r, i) => (i === s.index ? fn(r) : r)),
  }))

/** Moves to question `index`; past the last one opens the review. */
const goTo = ($: EngineInterface, index: number) =>
  edit($, s =>
    index >= s.questions.length ? { ...s, phase: 'review' } : { ...s, phase: 'answering', index: Math.max(0, index) },
  )

const close = ($: EngineInterface) => $.ui.close({ id: PANE })

const submit = async ($: EngineInterface) => {
  const s = await read($, session)
  if (!s) return
  const text = compileAnswers(s.questions, s.responses)
  if (!text) {
    $.ui.toast('answer: no answers provided')
    return
  }
  await update($, session, () => null)
  await close($)
  await $.prompt.submit({ text: `${SUBMIT_PREFIX}\n\n${text}`, asUser: true })
}

export const register: Register = (on, options) => {
  const model = typeof options.model === 'string' && options.model.trim() ? options.model.trim() : 'haiku'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'answer',
      description: "Answer the questions in Claude's last reply in an interactive pane (/answer new to re-extract)",
    })
    return next(e)
  })

  on('command.run', { command: 'answer' }, async ($, e) => {
    const messages = await $.session.messages()
    const last = [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim().length > 0)
    if (!last) return { text: 'answer: no assistant reply with text to answer yet.' }

    const current = await read($, session)
    const isFresh = e.args.trim() === 'new'
    if (
      !isFresh &&
      current &&
      current.source === last.text &&
      current.phase !== 'error' &&
      current.phase !== 'extracting'
    ) {
      // Same reply as last time: restore the draft instead of extracting again.
      await openPane($)
      return {}
    }

    await update($, session, () => ({
      source: last.text,
      phase: 'extracting' as const,
      questions: [],
      responses: [],
      index: 0,
    }))
    await openPane($)

    const reply = await $.model.complete({
      model,
      system: SYSTEM_PROMPT,
      prompt: last.text,
      maxTokens: 4096,
      effort: 'low',
      timeoutMs: 120_000,
    })
    if (!reply.isAnswered) {
      await edit($, s => ({ ...s, phase: 'error', error: `Extraction failed (${reply.reason}).` }))
      return {}
    }
    const questions = parseExtraction(reply.text)
    if (questions === null) {
      await edit($, s => ({ ...s, phase: 'error', error: 'The extraction model did not return valid JSON.' }))
      return {}
    }
    if (questions.length === 0) {
      await update($, session, () => null)
      await $.ui.close({ id: PANE })
      return { text: 'answer: no questions found in the last reply.' }
    }
    await edit($, s => ({
      ...s,
      phase: 'answering',
      questions,
      responses: questions.map(() => emptyResponse()),
      index: 0,
    }))
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = elements
    // Mobile has no Input: questions there are answered by picking options.
    const Input = 'Input' in elements ? elements.Input : undefined
    const s = await read($, session)

    if (!s) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Nothing to answer. Run /answer after a reply that asks you something.</Text>
          <Button key="close" role="dismiss" onPress={() => close($)}>
            Close
          </Button>
        </Box>
      )
    }

    if (s.phase === 'extracting') {
      return (
        <Box flexDirection="column">
          <Text dimColor>Extracting questions from the last reply using {model}…</Text>
        </Box>
      )
    }

    if (s.phase === 'error') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="red">{s.error ?? 'Something went wrong.'}</Text>
          <Text dimColor>Run /answer again to retry.</Text>
          <Button key="close" role="dismiss" onPress={() => close($)}>
            Close
          </Button>
        </Box>
      )
    }

    const total = s.questions.length
    const answered = s.questions.filter((q, i) => isAnswered(q, s.responses[i])).length

    if (s.phase === 'review') {
      const text = compileAnswers(s.questions, s.responses)
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>
            Review · {answered}/{total} answered
          </Text>
          {text ? <Markdown key="review" text={text} /> : <Text dimColor>No answers yet.</Text>}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key="submit" variant="primary" autoFocus onPress={() => submit($)}>
              Submit
            </Button>
            <Button key="back" onPress={() => goTo($, Math.min(s.index, total - 1))}>
              Back
            </Button>
            <Button key="cancel" onPress={() => close($)}>
              Later
            </Button>
          </Box>
          <Text dimColor>Unanswered questions are left out. Later keeps the draft: /answer reopens it.</Text>
        </Box>
      )
    }

    const q = s.questions[s.index]
    if (!q) return <Text dimColor>No question here.</Text>
    const r = s.responses[s.index] ?? emptyResponse()
    const isLast = s.index === total - 1
    const progress = s.questions
      .map((one, i) => (i === s.index ? '●' : isAnswered(one, s.responses[i]) ? '✓' : '·'))
      .join(' ')

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>
            Question {s.index + 1}/{total}
            {q.header ? ` · ${q.header}` : ''}
          </Text>
          <Text dimColor>{progress}</Text>
        </Box>
        <Text>{q.question}</Text>
        {q.context ? (
          <Text dimColor italic>
            {q.context}
          </Text>
        ) : null}
        {q.options.length > 0 ? (
          <Box flexDirection="column">
            <Text dimColor>{r.isMulti ? '[M] pick any' : '[S] pick one'}</Text>
            {q.options.map((opt, i) => {
              const isOn = r.selected.includes(i)
              const mark = r.isMulti ? (isOn ? '[x]' : '[ ]') : isOn ? '(•)' : '( )'
              return (
                <Box key={`row:${i}`} flexDirection="row" gap={1}>
                  <Button
                    key={`opt:${i}`}
                    plain
                    hotkey={String(i + 1)}
                    autoFocus={i === 0 ? true : undefined}
                    onPress={async () => {
                      await editResponse($, one => pickOption(one, i))
                      if (!r.isMulti) await goTo($, s.index + 1)
                    }}
                  >
                    {`${mark} ${opt.label}`}
                  </Button>
                  {opt.description ? (
                    <Text dimColor wrap="truncate-end">
                      {opt.description}
                    </Text>
                  ) : null}
                </Box>
              )
            })}
          </Box>
        ) : null}
        {Input ? (
          <Input
            key={`custom:${q.id}`}
            label={q.options.length > 0 ? 'Other: ' : 'Answer: '}
            placeholder={q.options.length > 0 ? 'type a custom answer' : 'type your answer'}
            value={r.custom}
            submitLabel={isLast ? 'review' : 'next'}
            autoFocus={q.options.length === 0 ? true : undefined}
            onInput={value => editResponse($, one => setCustom(one, value))}
            onSubmit={async value => {
              await editResponse($, one => setCustom(one, value))
              await goTo($, s.index + 1)
            }}
          />
        ) : null}
        {isAnswered(q, r) ? <Text dimColor>Answer: {formatAnswer(q, r)}</Text> : null}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="prev" onPress={() => goTo($, s.index - 1)}>
            ← Prev
          </Button>
          <Button key="next" variant={isLast ? undefined : 'primary'} onPress={() => goTo($, s.index + 1)}>
            {isLast ? 'Done →' : 'Next →'}
          </Button>
          {q.options.length > 0 ? (
            <Button key="mode" onPress={() => editResponse($, toggleMulti)}>
              {r.isMulti ? 'Single-select' : 'Multi-select'}
            </Button>
          ) : null}
          <Button
            key="review"
            label={`Review (${answered}/${total})`}
            variant={isLast ? 'primary' : undefined}
            onPress={() => goTo($, total)}
          />
        </Box>
      </Box>
    )
  })
}
