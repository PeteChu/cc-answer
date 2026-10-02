import type { Elements } from 'claude-code'

import type { ProtoQuestion, ProtoSession } from '../../types'
import { DESIGNS, KEY_BACK, KEY_CANCEL, KEY_NEXT, MAX_OPTIONS, answerText, isDone } from './model'

type Table = Elements['terminal']
export type Els = { Box: Table['Box']; Text: Table['Text']; Button: Table['Button'] }

export type Actions = {
  pick: (option: number) => void
  next: () => void
  back: () => void
  goTo: (index: number) => void
  cancel: () => void
  submit: () => void
}

export type View = { E: Els; s: ProtoSession; cols: number; act: Actions }

/** Claude Code's theme keys: the accent, the dialog border, the suggestion blue. */
const ACCENT = 'claude'
const BORDER = 'permission'
const SUGGEST = 'suggestion'
const OK = 'success'

const current = (s: ProtoSession): ProtoQuestion => s.questions[s.index] as ProtoQuestion
const shown = (q: ProtoQuestion) => q.options.slice(0, MAX_OPTIONS)
const isOn = (s: ProtoSession, option: number) => s.responses[s.index]?.selected.includes(option) ?? false
const mark = (q: ProtoQuestion, on: boolean) => (q.multiSelect ? (on ? '☒' : '☐') : on ? '●' : '○')
const rule = (cols: number) => '─'.repeat(Math.max(10, cols))
const typeHint = (q: ProtoQuestion) =>
  q.options.length === 0 ? 'type your answer in the prompt, Enter' : 'or type your own answer in the prompt'

function keysHint(s: ProtoSession): string {
  const q = current(s)
  const parts: string[] = []
  if (q.options.length) parts.push(`1-${shown(q).length} ${q.multiSelect ? 'toggle' : 'pick'}`)
  parts.push(typeHint(q))
  if (s.index > 0) parts.push(`${KEY_BACK} back`)
  parts.push(`${KEY_NEXT} ${q.multiSelect ? 'done' : 'skip'}`, `${KEY_CANCEL} cancel`)
  return parts.join(' · ')
}

/** Back / Skip-or-Done / Cancel as plain hotkey buttons: `8: ← Back`. */
function controls(v: View, gap = 2) {
  const { Box, Button } = v.E
  const q = current(v.s)
  return (
    <Box flexDirection="row" gap={gap}>
      {v.s.index > 0 ? (
        <Button key="back" plain dimColor hotkey={KEY_BACK} label="← Back" onPress={v.act.back} />
      ) : null}
      <Button
        key="next"
        plain
        dimColor
        hotkey={KEY_NEXT}
        label={q.multiSelect ? 'Done →' : 'Skip →'}
        onPress={v.act.next}
      />
      <Button key="cancel" plain dimColor hotkey={KEY_CANCEL} label="Cancel" onPress={v.act.cancel} />
    </Box>
  )
}

/** The review screen every design ends on; `framed` wraps it like the prompt card. */
export function review(v: View, framed = false) {
  const { Box, Text, Button } = v.E
  const body = (
    <Box flexDirection="column">
      <Text color={ACCENT}>✻ Review your answers</Text>
      {v.s.questions.map((q, i) => {
        const a = answerText(q, v.s.responses[i])
        return (
          <Box key={`r:${i}`} flexDirection="row">
            <Text dimColor>{i === 0 ? '  ⎿  ' : '     '}</Text>
            <Text bold>{q.header}: </Text>
            {a ? (
              <Text>{a}</Text>
            ) : (
              <Text dimColor italic>
                skipped
              </Text>
            )}
          </Box>
        )
      })}
      <Box flexDirection="row" gap={2} marginTop={1}>
        <Button key="submit" plain hotkey="1" label="Submit" onPress={v.act.submit} />
        <Button key="back" plain dimColor hotkey={KEY_BACK} label="← Back" onPress={v.act.back} />
        <Button key="cancel" plain dimColor hotkey={KEY_CANCEL} label="Cancel" onPress={v.act.cancel} />
      </Box>
    </Box>
  )
  if (!framed) return body
  return (
    <Box borderStyle="round" borderColor={ACCENT} paddingX={1} flexDirection="column">
      {body}
    </Box>
  )
}

// 1. Ask dialog: the built-in AskUserQuestion look, tabs and all.
function askDialog(v: View) {
  const { Box, Text, Button } = v.E
  const q = current(v.s)
  return (
    <Box flexDirection="column">
      <Text color={BORDER}>{rule(v.cols)}</Text>
      <Box flexDirection="row" gap={2}>
        <Text dimColor>←</Text>
        {v.s.questions.map((one, i) => (
          <Button
            key={`tab:${i}`}
            plain
            dimColor={i !== v.s.index}
            label={`${isDone(v.s, i) ? '☒' : '☐'} ${one.header}`}
            onPress={() => v.act.goTo(i)}
          />
        ))}
        <Text dimColor>✔ Submit →</Text>
      </Box>
      <Box marginTop={1}>
        <Text bold>{q.question}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {shown(q).map((opt, i) => (
          <Box key={`o:${i}`} flexDirection="column">
            <Box flexDirection="row">
              <Text color={SUGGEST}>{isOn(v.s, i) ? '❯ ' : '  '}</Text>
              <Button
                key={`opt:${i}`}
                plain
                hotkey={String(i + 1)}
                label={`${mark(q, isOn(v.s, i))} ${opt.label}`}
                onPress={() => v.act.pick(i)}
              />
            </Box>
            {opt.description ? <Text dimColor>{`       ${opt.description}`}</Text> : null}
          </Box>
        ))}
        <Text dimColor>{`  ✎  ${typeHint(q)}`}</Text>
      </Box>
      <Text color={BORDER}>{rule(v.cols)}</Text>
      {controls(v)}
      <Text dimColor>{keysHint(v.s)}</Text>
    </Box>
  )
}

// 2. Survey line: two lines, like "How is Claude doing this session?".
function surveyLine(v: View) {
  const { Box, Text, Button } = v.E
  const q = current(v.s)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={ACCENT}>● </Text>
        <Text bold>{q.question} </Text>
        <Text dimColor>
          ({v.s.index + 1}/{v.s.questions.length}
          {q.multiSelect ? ', pick any' : ''})
        </Text>
      </Box>
      <Box flexDirection="row" gap={3} flexWrap="wrap" paddingLeft={2}>
        {shown(q).map((opt, i) => (
          <Button
            key={`opt:${i}`}
            plain
            hotkey={String(i + 1)}
            label={q.multiSelect && isOn(v.s, i) ? `✓ ${opt.label}` : opt.label}
            onPress={() => v.act.pick(i)}
          />
        ))}
        {q.options.length === 0 ? <Text dimColor>Type your answer in the prompt and press Enter</Text> : null}
        <Button
          key="next"
          plain
          dimColor
          hotkey={KEY_NEXT}
          label={q.multiSelect ? 'Done' : 'Skip'}
          onPress={v.act.next}
        />
        <Button key="cancel" plain dimColor hotkey={KEY_CANCEL} label="Dismiss" onPress={v.act.cancel} />
      </Box>
    </Box>
  )
}

// 3. Transcript thread: ⏺ bullets and ⎿ elbows, as tool rows read.
function transcriptThread(v: View) {
  const { Box, Text, Button } = v.E
  return (
    <Box flexDirection="column">
      {v.s.questions.map((q, i) => {
        if (i !== v.s.index) {
          const a = answerText(q, v.s.responses[i])
          return (
            <Box key={`q:${i}`} flexDirection="row">
              <Text color={a ? OK : undefined} dimColor={!a}>
                ⏺{' '}
              </Text>
              <Text dimColor>
                {q.header}
                {a ? ` · ${a}` : i > v.s.index ? '' : ' · skipped'}
              </Text>
            </Box>
          )
        }
        return (
          <Box key={`q:${i}`} flexDirection="column">
            <Box flexDirection="row">
              <Text color={ACCENT}>⏺ </Text>
              <Text bold>{q.question}</Text>
            </Box>
            {shown(q).map((opt, o) => (
              <Box key={`o:${o}`} flexDirection="row">
                <Text dimColor>{o === 0 ? '  ⎿  ' : '     '}</Text>
                <Button
                  key={`opt:${o}`}
                  plain
                  hotkey={String(o + 1)}
                  label={`${mark(q, isOn(v.s, o))} ${opt.label}`}
                  onPress={() => v.act.pick(o)}
                />
                {opt.description ? <Text dimColor>{`  ${opt.description}`}</Text> : null}
              </Box>
            ))}
            {q.options.length === 0 ? <Text dimColor> ⎿ Type your answer in the prompt and press Enter</Text> : null}
            <Box paddingLeft={5}>{controls(v)}</Box>
          </Box>
        )
      })}
    </Box>
  )
}

// 4. Todo checklist: the ✻ status header and ☐/☒ list of the todo tool.
function todoChecklist(v: View) {
  const { Box, Text, Button } = v.E
  const done = v.s.questions.filter((_, i) => isDone(v.s, i)).length
  return (
    <Box flexDirection="column">
      <Text color={ACCENT}>
        ✻ Answering Claude's questions…{' '}
        <Text dimColor>
          ({done}/{v.s.questions.length} answered)
        </Text>
      </Text>
      {v.s.questions.map((q, i) => {
        const a = answerText(q, v.s.responses[i])
        const isHere = i === v.s.index
        return (
          <Box key={`q:${i}`} flexDirection="column">
            <Box flexDirection="row">
              <Text dimColor>{i === 0 ? '  ⎿  ' : '     '}</Text>
              <Text bold={isHere} dimColor={!isHere && !a} strikethrough={!isHere && Boolean(a)}>
                {a ? '☒' : '☐'} {isHere ? q.question : q.header}
              </Text>
              {!isHere && a ? <Text dimColor> — {a}</Text> : null}
            </Box>
            {isHere ? (
              <Box flexDirection="row" gap={2} flexWrap="wrap" paddingLeft={9}>
                {shown(q).map((opt, o) => (
                  <Button
                    key={`opt:${o}`}
                    plain
                    hotkey={String(o + 1)}
                    label={q.multiSelect ? `${mark(q, isOn(v.s, o))} ${opt.label}` : opt.label}
                    onPress={() => v.act.pick(o)}
                  />
                ))}
                {q.options.length === 0 ? <Text dimColor>type in the prompt ↵</Text> : null}
              </Box>
            ) : null}
          </Box>
        )
      })}
      <Box paddingLeft={5}>{controls(v)}</Box>
    </Box>
  )
}

// 5. Stepper: a progress bar and bracketed buttons.
function stepper(v: View) {
  const { Box, Text, Button } = v.E
  const q = current(v.s)
  const width = Math.max(10, Math.min(40, v.cols - 20))
  const filled = Math.round((width * v.s.index) / v.s.questions.length)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold>
          Question {v.s.index + 1} of {v.s.questions.length}
        </Text>
        <Text color={ACCENT}>{'━'.repeat(filled)}</Text>
        <Text dimColor>{'─'.repeat(width - filled)}</Text>
      </Box>
      <Text dimColor>
        {q.header} · {q.multiSelect ? 'pick any' : q.options.length ? 'pick one' : 'free text'}
      </Text>
      <Box marginY={1}>
        <Text>{q.question}</Text>
      </Box>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {shown(q).map((opt, o) => (
          <Button
            key={`opt:${o}`}
            hotkey={String(o + 1)}
            variant={isOn(v.s, o) ? 'primary' : undefined}
            label={`${o + 1} ${q.multiSelect ? `${mark(q, isOn(v.s, o))} ` : ''}${opt.label}`}
            onPress={() => v.act.pick(o)}
          />
        ))}
        {q.options.length === 0 ? <Text dimColor>Type your answer in the prompt ↵</Text> : null}
      </Box>
      <Box flexDirection="row" gap={1} marginTop={1}>
        {v.s.index > 0 ? (
          <Button key="back" dimColor hotkey={KEY_BACK} label={`${KEY_BACK} ← Back`} onPress={v.act.back} />
        ) : null}
        <Button
          key="next"
          hotkey={KEY_NEXT}
          label={`${KEY_NEXT} ${q.multiSelect ? 'Done' : 'Skip'} →`}
          onPress={v.act.next}
        />
        <Button key="cancel" dimColor hotkey={KEY_CANCEL} label={`${KEY_CANCEL} Cancel`} onPress={v.act.cancel} />
      </Box>
    </Box>
  )
}

// 6. Prompt card: a rounded box in the accent color, as the prompt box is drawn.
function promptCard(v: View) {
  const { Box, Text, Button } = v.E
  const q = current(v.s)
  return (
    <Box borderStyle="round" borderColor={ACCENT} paddingX={1} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={ACCENT}>✻ Claude asked {v.s.questions.length} questions</Text>
        <Text dimColor>
          {q.header} · {v.s.index + 1}/{v.s.questions.length}
        </Text>
      </Box>
      <Box marginY={1}>
        <Text bold>{q.question}</Text>
      </Box>
      {shown(q).map((opt, o) => (
        <Box key={`o:${o}`} flexDirection="row" gap={1}>
          <Button
            key={`opt:${o}`}
            plain
            hotkey={String(o + 1)}
            label={`${mark(q, isOn(v.s, o))} ${opt.label}`}
            onPress={() => v.act.pick(o)}
          />
          {opt.description ? <Text dimColor>— {opt.description}</Text> : null}
        </Box>
      ))}
      <Text dimColor>{`✎ ${typeHint(q)}`}</Text>
      <Box marginTop={1}>{controls(v)}</Box>
    </Box>
  )
}

// 7. Chips: the answers so far on one line, options as wrapping chips.
function chips(v: View) {
  const { Box, Text, Button } = v.E
  const q = current(v.s)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {v.s.questions.map((one, i) => {
          const a = answerText(one, v.s.responses[i])
          return (
            <Button
              key={`chip:${i}`}
              plain
              dimColor={i !== v.s.index}
              label={`${one.header}: ${a || '—'}`}
              onPress={() => v.act.goTo(i)}
            />
          )
        })}
      </Box>
      <Box flexDirection="row" marginTop={1}>
        <Text color={SUGGEST}>? </Text>
        <Text bold>{q.question}</Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" gap={1} paddingLeft={2}>
        {shown(q).map((opt, o) => (
          <Button
            key={`opt:${o}`}
            hotkey={String(o + 1)}
            variant={isOn(v.s, o) ? 'primary' : undefined}
            label={`${o + 1} ${opt.label}${isOn(v.s, o) ? ' ✓' : ''}`}
            onPress={() => v.act.pick(o)}
          />
        ))}
        {q.options.length === 0 ? <Text dimColor>type in the prompt ↵</Text> : null}
      </Box>
      <Box paddingLeft={2}>{controls(v)}</Box>
    </Box>
  )
}

// 8. Accordion: every question at once, the current one open.
function accordion(v: View) {
  const { Box, Text, Button } = v.E
  const width = Math.max(...v.s.questions.map(q => q.header.length))
  return (
    <Box flexDirection="column">
      {v.s.questions.map((q, i) => {
        const a = answerText(q, v.s.responses[i])
        const isHere = i === v.s.index
        const row = `${isHere ? '▾' : '▸'} ${q.header.padEnd(width)}  `
        return (
          <Box key={`q:${i}`} flexDirection="column">
            <Box flexDirection="row">
              <Button key={`row:${i}`} plain dimColor={!isHere} label={row} onPress={() => v.act.goTo(i)} />
              {isHere ? <Text bold>{q.question}</Text> : <Text dimColor={!a}>{a || '—'}</Text>}
            </Box>
            {isHere ? (
              <Box flexDirection="column" paddingLeft={width + 4}>
                {shown(q).map((opt, o) => (
                  <Button
                    key={`opt:${o}`}
                    plain
                    hotkey={String(o + 1)}
                    label={`${mark(q, isOn(v.s, o))} ${opt.label}`}
                    onPress={() => v.act.pick(o)}
                  />
                ))}
                <Text dimColor>{`✎ ${typeHint(q)}`}</Text>
              </Box>
            ) : null}
          </Box>
        )
      })}
      {controls(v)}
    </Box>
  )
}

// 9. Ghost suggestion: the band stays tiny; the prompt box carries the pick as Tab-able ghost text.
function ghostSuggestion(v: View) {
  const { Box, Text, Button } = v.E
  const q = current(v.s)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap">
        <Text color={SUGGEST}>↳ </Text>
        <Text>{q.question} </Text>
        {shown(q).map((opt, o) => (
          <Box key={`o:${o}`} marginRight={1}>
            <Button
              key={`opt:${o}`}
              plain
              dimColor={!isOn(v.s, o)}
              hotkey={String(o + 1)}
              label={opt.label}
              onPress={() => v.act.pick(o)}
            />
          </Box>
        ))}
      </Box>
      <Box flexDirection="row" gap={2} paddingLeft={2}>
        <Text dimColor>{`Tab takes the suggestion · Enter answers · ${v.s.index + 1}/${v.s.questions.length}`}</Text>
        {controls(v)}
      </Box>
    </Box>
  )
}

// 10. Split view: the list on the left, the question on the right; stacked when narrow.
function splitView(v: View) {
  const { Box, Text, Button } = v.E
  const q = current(v.s)
  const isWide = v.cols >= 72
  const left = Math.min(28, Math.floor(v.cols * 0.32))
  const list = (
    <Box
      flexDirection="column"
      width={isWide ? left : undefined}
      borderStyle="single"
      borderColor={BORDER}
      paddingX={1}
    >
      {v.s.questions.map((one, i) => (
        <Button
          key={`row:${i}`}
          plain
          dimColor={i !== v.s.index}
          label={`${i === v.s.index ? '❯' : isDone(v.s, i) ? '✓' : ' '} ${one.header}`}
          onPress={() => v.act.goTo(i)}
        />
      ))}
    </Box>
  )
  const detail = (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold>{q.question}</Text>
      {shown(q).map((opt, o) => (
        <Box key={`o:${o}`} flexDirection="column">
          <Button
            key={`opt:${o}`}
            plain
            hotkey={String(o + 1)}
            label={`${mark(q, isOn(v.s, o))} ${opt.label}`}
            onPress={() => v.act.pick(o)}
          />
          {opt.description ? <Text dimColor>{`     ${opt.description}`}</Text> : null}
        </Box>
      ))}
      <Text dimColor>{`✎ ${typeHint(q)}`}</Text>
      {controls(v)}
    </Box>
  )
  return (
    <Box flexDirection={isWide ? 'row' : 'column'}>
      {list}
      {detail}
    </Box>
  )
}

const VIEWS = [
  askDialog,
  surveyLine,
  transcriptThread,
  todoChecklist,
  stepper,
  promptCard,
  chips,
  accordion,
  ghostSuggestion,
  splitView,
]

if (VIEWS.length !== DESIGNS.length) throw new Error('answer: every design needs a view')

/** Draws the band for the session's design: its answering view, or the shared review. */
export function drawDesign(v: View) {
  if (v.s.phase === 'review') return review(v, v.s.design === 6)
  const view = VIEWS[v.s.design - 1] ?? askDialog
  return view(v)
}
