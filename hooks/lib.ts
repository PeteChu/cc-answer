import type { AnswerOption, AnswerQuestion, AnswerResponse } from '../types'

export const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering by the user.

Output ONLY a JSON object with this structure, no prose:
{
  "questions": [
    {
      "id": "preferred_database",
      "header": "Database",
      "question": "What is your preferred database?",
      "context": "Optional context that helps answer the question",
      "options": [
        { "label": "PostgreSQL", "description": "Mature relational option with strong ecosystem" }
      ]
    }
  ]
}

Rules:
- Extract all questions that require user input
- Keep questions in the order they appeared
- Keep id values stable snake_case when possible
- Header is optional and concise; omit it when the question alone is clear
- Include context only when it provides essential information for answering
- Prefer a finite set of selectable options whenever one can be reasonably derived from the question or its context
- Extract every concrete choice stated or clearly implied by the text; do not invent arbitrary choices
- For confirmation, permission or decision questions, use Yes and No options when that is a natural answer format
- Use no options (free text) only when no meaningful finite set can be derived
- Each option needs a short label and a one-sentence description
- Option labels should fully represent the answer to the question on their own
- If no questions are found, return {"questions": []}`

export const SUBMIT_PREFIX = 'I answered your questions in the following way:'

const MAX_OPTIONS = 9

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toSnake(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
}

/** Drops empty questions, trims fields, keeps options with usable labels, stabilises ids. */
export function normalizeQuestions(raw: unknown): AnswerQuestion[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: AnswerQuestion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    const question = str(q.question)
    if (!question) continue
    let id = toSnake(str(q.id)) || toSnake(question) || `q${out.length + 1}`
    while (seen.has(id)) id = `${id}_${out.length + 1}`
    seen.add(id)
    const options: AnswerOption[] = []
    if (Array.isArray(q.options)) {
      for (const opt of q.options) {
        const label = typeof opt === 'string' ? opt.trim() : str((opt as Record<string, unknown>)?.label)
        if (!label || options.some(o => o.label === label)) continue
        const description = typeof opt === 'object' ? str((opt as Record<string, unknown>)?.description) : ''
        options.push(description ? { label, description } : { label })
        if (options.length === MAX_OPTIONS) break
      }
    }
    const header = str(q.header)
    const context = str(q.context)
    out.push({
      id,
      question,
      options,
      ...(header ? { header } : {}),
      ...(context ? { context } : {}),
    })
  }
  return out
}

/** Reads the extractor's reply: bare JSON, a fenced block, or the outermost {...}. */
export function parseExtraction(text: string): AnswerQuestion[] | null {
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

export function emptyResponse(): AnswerResponse {
  return { selected: [], custom: '', isMulti: false }
}

/** The answer text for one question: picked labels, then the custom text, joined with ", ". */
export function formatAnswer(question: AnswerQuestion, response: AnswerResponse | undefined): string {
  if (!response) return ''
  const parts = response.selected.flatMap(i => {
    const option = question.options[i]
    return option ? [option.label] : []
  })
  const custom = response.custom.trim()
  if (custom) parts.push(custom)
  return parts.join(', ')
}

export function isAnswered(question: AnswerQuestion, response: AnswerResponse | undefined): boolean {
  return formatAnswer(question, response).length > 0
}

/** Q/A blocks for every answered question; unanswered ones are left out. */
export function compileAnswers(questions: AnswerQuestion[], responses: AnswerResponse[]): string {
  return questions
    .map((q, i) => ({ q, a: formatAnswer(q, responses[i]) }))
    .filter(({ a }) => a.length > 0)
    .map(({ q, a }) => `Q: ${q.question}\nA: ${a}`)
    .join('\n\n')
}

/** Picks option `index`: single-select replaces the pick and drops custom text, multi-select toggles. */
export function pickOption(response: AnswerResponse, index: number): AnswerResponse {
  if (response.isMulti) {
    const selected = response.selected.includes(index)
      ? response.selected.filter(i => i !== index)
      : [...response.selected, index].sort((a, b) => a - b)
    return { ...response, selected }
  }
  return { ...response, selected: [index], custom: '' }
}

/** Sets the custom text; in single-select a custom answer replaces the picked option. */
export function setCustom(response: AnswerResponse, text: string): AnswerResponse {
  if (response.isMulti || !text.trim()) return { ...response, custom: text }
  return { ...response, custom: text, selected: [] }
}

/** Switches single/multi; going back to single keeps only the first pick. */
export function toggleMulti(response: AnswerResponse): AnswerResponse {
  if (response.isMulti) {
    const first = response.selected[0]
    const keepCustom = first === undefined
    return {
      isMulti: false,
      selected: first === undefined ? [] : [first],
      custom: keepCustom ? response.custom : '',
    }
  }
  return { ...response, isMulti: true }
}
