/** One question in the shape the built-in AskUserQuestion dialog draws. */
export type AskQuestion = {
  question: string
  header: string
  options: { label: string; description: string }[]
  multiSelect: boolean
}

export const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract every question that needs an answer from the user, shaped for a multiple-choice dialog.

Output ONLY a JSON object with this structure, no prose:
{
  "questions": [
    {
      "question": "Which database should the service use?",
      "header": "Database",
      "multiSelect": false,
      "options": [
        { "label": "PostgreSQL", "description": "Mature relational option with a strong ecosystem" },
        { "label": "SQLite", "description": "Embedded, zero setup" }
      ]
    }
  ]
}

Rules:
- Extract all questions that require user input, in the order they appeared
- "question" is clear, self-contained and ends with a question mark; fold in any context essential to answer it
- "header" is a very short chip label, at most 12 characters (e.g. "Database", "Auth method")
- Give 2 to 4 options per question; the dialog always adds its own free-text "Type something" row, so never add an "Other" option
- Extract every concrete choice stated or clearly implied by the text; for yes/no, confirmation or permission questions use "Yes" and "No"
- For open-ended questions (a name, a description), offer 2 to 4 sensible suggestions the text supports
- Option labels are concise (1-5 words) and fully answer the question on their own; each description is one short sentence
- Set "multiSelect": true only when the choices are not mutually exclusive
- If no questions are found, return {"questions": []}`

export const SUBMIT_PREFIX = 'I answered your questions in the following way:'

/** The dialog's limits, which it enforces: questions per dialog, options per question, header length. */
export const MAX_QUESTIONS = 4
const MAX_OPTIONS = 4
const MIN_OPTIONS = 2
const MAX_HEADER = 12

/** Pads a question that came back with fewer than two options; "Type something" still takes free text. */
const PADDING = [
  { label: 'No preference', description: 'Go with whatever you think is best' },
  { label: 'Not sure yet', description: 'I need more information before deciding' },
]

function str(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** Coerces the extractor's output into questions the dialog accepts, with unique texts. */
export function normalizeQuestions(raw: unknown): AskQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: AskQuestion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    let question = str(q.question)
    if (!question) continue
    // The dialog answers by question text, so texts must be unique.
    while (out.some(one => one.question === question)) question = `${question} (${out.length + 1})`

    const options: AskQuestion['options'] = []
    if (Array.isArray(q.options)) {
      for (const opt of q.options) {
        const record = opt && typeof opt === 'object' ? (opt as Record<string, unknown>) : {}
        const label = typeof opt === 'string' ? str(opt) : str(record.label)
        if (!label || /^(other|type something)\b/i.test(label) || options.some(o => o.label === label)) continue
        options.push({ label, description: str(record.description) })
        if (options.length === MAX_OPTIONS) break
      }
    }
    for (const pad of PADDING) {
      if (options.length >= MIN_OPTIONS) break
      if (!options.some(o => o.label === pad.label)) options.push(pad)
    }

    const header = (str(q.header) || `Q${out.length + 1}`).slice(0, MAX_HEADER).trim()
    out.push({ question, header, options, multiSelect: q.multiSelect === true })
  }
  return out
}

/** Reads the extractor's reply: bare JSON, a fenced block, or the outermost {...}. */
export function parseExtraction(text: string): AskQuestion[] | null {
  const candidates: string[] = []
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  candidates.push(text.trim())
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { questions?: unknown }
      if (parsed && Array.isArray(parsed.questions)) return normalizeQuestions(parsed.questions)
    } catch {
      // try the next candidate
    }
  }
  return null
}

/** Splits questions into dialogs of at most four. */
export function batches<T>(items: readonly T[], size = MAX_QUESTIONS): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Reads one answer from the dialog's `answers` map (question text -> answer). */
export function answerFor(answers: unknown, question: string): string {
  if (!answers || typeof answers !== 'object') return ''
  const value = (answers as Record<string, unknown>)[question]
  if (Array.isArray(value)) return value.map(str).filter(Boolean).join(', ')
  return str(value)
}

/** Q/A blocks for every answered question; unanswered ones are left out. */
export function compileAnswers(questions: readonly AskQuestion[], answers: readonly string[]): string {
  return questions
    .map((q, i) => ({ q, a: (answers[i] ?? '').trim() }))
    .filter(({ a }) => a.length > 0)
    .map(({ q, a }) => `Q: ${q.question}\nA: ${a}`)
    .join('\n\n')
}
