import type { ProtoOption, ProtoQuestion, ProtoResponse, ProtoSession } from '../../types'

/** Option hotkeys are 1-7; 8, 9 and 0 are Back, Skip/Done and Cancel in every design. */
export const MAX_OPTIONS = 7
export const KEY_BACK = '8'
export const KEY_NEXT = '9'
export const KEY_CANCEL = '0'

export const DESIGNS = [
  { name: 'Ask dialog', blurb: 'Mirrors the built-in AskUserQuestion dialog: tabs, ❯ cursor, descriptions' },
  { name: 'Survey line', blurb: 'Two compact lines, like the session feedback survey' },
  { name: 'Transcript thread', blurb: '⏺ / ⎿ rows that read like the transcript itself' },
  { name: 'Todo checklist', blurb: '✻ header and ☐/☒ items, like the todo list' },
  { name: 'Stepper', blurb: 'One question at a time with a progress bar and button row' },
  { name: 'Prompt card', blurb: 'A rounded, accent-bordered card like the prompt box' },
  { name: 'Chips', blurb: 'A running answer summary and options as wrapping chips' },
  { name: 'Accordion', blurb: 'Every question listed; the current one expanded' },
  { name: 'Ghost suggestion', blurb: 'Minimal band; the pick appears as Tab-able ghost text in the prompt' },
  { name: 'Split view', blurb: 'Question list on the left, the current question on the right' },
] as const

export const DEMO_QUESTIONS: ProtoQuestion[] = [
  {
    id: 'database',
    header: 'Database',
    question: 'Which database should the service use?',
    multiSelect: false,
    options: [
      { label: 'PostgreSQL', description: 'Mature relational option with a strong ecosystem' },
      { label: 'SQLite', description: 'Embedded, zero setup, great for a single node' },
      { label: 'DynamoDB', description: 'Managed key-value store, scales without ops' },
    ],
  },
  {
    id: 'features',
    header: 'Features',
    question: 'Which features should ship in v1?',
    multiSelect: true,
    options: [
      { label: 'Search', description: 'Full-text search across records' },
      { label: 'Export', description: 'CSV and JSON downloads' },
      { label: 'Sharing', description: 'Share links with view or edit access' },
      { label: 'Themes', description: 'Light and dark mode' },
    ],
  },
  {
    id: 'tests',
    header: 'Tests',
    question: 'Should I add integration tests now?',
    multiSelect: false,
    options: [
      { label: 'Yes', description: 'Add them in this change' },
      { label: 'No', description: 'Leave them for a follow-up' },
    ],
  },
  {
    id: 'name',
    header: 'Name',
    question: 'What should the service be called?',
    multiSelect: false,
    options: [],
  },
]

export const RICH_PROMPT = `You are a question extractor. Given text from a conversation, extract every question that needs an answer from the user.

Output ONLY a JSON object, no prose:
{"questions":[{"id":"database","header":"Database","question":"Which database should the service use?","multiSelect":false,"options":[{"label":"PostgreSQL","description":"Mature relational option"}]}]}

Rules:
- Keep the order the questions appeared in; "question" is self-contained and ends with "?"
- "header" is a short label of at most 12 characters
- Give up to 7 options when a finite set is stated or clearly implied (Yes/No for confirmations); give [] for open-ended questions
- Labels are 1-5 words; each description is one short sentence
- "multiSelect" is true only when the choices are not mutually exclusive
- If there are no questions, return {"questions":[]}`

function str(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

export function normalizeRich(raw: unknown): ProtoQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: ProtoQuestion[] = []
  for (const item of raw) {
    const q = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const question = str(q.question)
    if (!question) continue
    const options: ProtoOption[] = []
    for (const opt of Array.isArray(q.options) ? q.options : []) {
      const record = opt && typeof opt === 'object' ? (opt as Record<string, unknown>) : {}
      const label = typeof opt === 'string' ? str(opt) : str(record.label)
      if (!label || options.some(o => o.label === label)) continue
      const description = str(record.description)
      options.push(description ? { label, description } : { label })
      if (options.length === MAX_OPTIONS) break
    }
    out.push({
      id: str(q.id) || `q${out.length + 1}`,
      header: (str(q.header) || `Q${out.length + 1}`).slice(0, 12),
      question,
      multiSelect: q.multiSelect === true,
      options,
    })
  }
  return out
}

export function parseRich(text: string): ProtoQuestion[] | null {
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  for (const candidate of [text.trim(), first >= 0 && last > first ? text.slice(first, last + 1) : '']) {
    try {
      const parsed = JSON.parse(candidate) as { questions?: unknown }
      if (Array.isArray(parsed?.questions)) return normalizeRich(parsed.questions)
    } catch {
      // next candidate
    }
  }
  return null
}

export function startSession(design: number, questions: ProtoQuestion[], source: 'demo' | 'live'): ProtoSession {
  return {
    design,
    source,
    questions,
    responses: questions.map(() => ({ selected: [], custom: '' })),
    index: 0,
    phase: 'answering',
  }
}

export function answerText(q: ProtoQuestion, r: ProtoResponse | undefined): string {
  if (!r) return ''
  const parts = r.selected.flatMap(i => (q.options[i] ? [q.options[i].label] : []))
  if (r.custom.trim()) parts.push(r.custom.trim())
  return parts.join(', ')
}

export const isDone = (s: ProtoSession, i: number) => {
  const q = s.questions[i]
  return q ? answerText(q, s.responses[i]).length > 0 : false
}

export function compile(s: ProtoSession): string {
  return s.questions
    .map((q, i) => ({ q, a: answerText(q, s.responses[i]) }))
    .filter(({ a }) => a)
    .map(({ q, a }) => `Q: ${q.question}\nA: ${a}`)
    .join('\n\n')
}

const withResponse = (s: ProtoSession, fn: (r: ProtoResponse) => ProtoResponse): ProtoSession => ({
  ...s,
  responses: s.responses.map((r, i) => (i === s.index ? fn(r) : r)),
})

export function next(s: ProtoSession): ProtoSession {
  return s.index + 1 >= s.questions.length ? { ...s, phase: 'review' } : { ...s, index: s.index + 1 }
}

export function back(s: ProtoSession): ProtoSession {
  if (s.phase === 'review') return { ...s, phase: 'answering', index: s.questions.length - 1 }
  return { ...s, index: Math.max(0, s.index - 1) }
}

export function goTo(s: ProtoSession, index: number): ProtoSession {
  return { ...s, phase: 'answering', index: Math.min(Math.max(0, index), s.questions.length - 1) }
}

/** A digit: single-select picks and moves on; multi-select toggles and stays. */
export function pick(s: ProtoSession, option: number): ProtoSession {
  const q = s.questions[s.index]
  if (!q || !q.options[option]) return s
  if (q.multiSelect) {
    return withResponse(s, r => ({
      ...r,
      selected: r.selected.includes(option)
        ? r.selected.filter(i => i !== option)
        : [...r.selected, option].sort((a, b) => a - b),
    }))
  }
  return next(withResponse(s, r => ({ ...r, selected: [option], custom: '' })))
}

/** Text typed in the prompt: an option's label (or its number) picks it; anything else is a custom answer. */
export function custom(s: ProtoSession, text: string): ProtoSession {
  const q = s.questions[s.index]
  const value = text.trim()
  if (!q || !value) return s
  const asNumber = /^[1-7]$/.test(value) ? Number(value) - 1 : -1
  const byLabel = q.options.findIndex(o => o.label.toLowerCase() === value.toLowerCase())
  const option = asNumber >= 0 && q.options[asNumber] ? asNumber : byLabel
  if (option >= 0) {
    const picked = pick(s, option)
    return q.multiSelect ? next(picked) : picked
  }
  if (q.multiSelect) return next(withResponse(s, r => ({ ...r, custom: value })))
  return next(withResponse(s, () => ({ selected: [], custom: value })))
}
