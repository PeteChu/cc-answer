/**
 * One question in the shape the built-in AskUserQuestion dialog draws.
 * @typedef {{ question: string, header: string, options: { label: string, description: string }[], multiSelect: boolean }} AskQuestion
 */

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

/** @returns {string} */
function str(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/**
 * Coerces the extractor's output into questions the dialog accepts, with unique texts.
 * @returns {AskQuestion[]}
 */
export function normalizeQuestions(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const q of raw) {
    if (!q || typeof q !== 'object') continue
    let question = str(q.question)
    if (!question) continue
    // The dialog answers by question text, so texts must be unique.
    while (out.some(one => one.question === question)) question = `${question} (${out.length + 1})`

    const options = []
    if (Array.isArray(q.options)) {
      for (const opt of q.options) {
        const record = opt && typeof opt === 'object' ? opt : {}
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

/**
 * Repairs what models commonly get wrong in JSON: raw newlines and tabs inside
 * strings, smart quotes used as delimiters, and trailing commas.
 * @param {string} text
 */
export function repairJson(text) {
  let out = ''
  let inString = false
  // A string a smart quote opened is closed by a smart quote too.
  let isSmart = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') {
        out += ch + (text[i + 1] ?? '')
        i++
      } else if (ch === '"' || (isSmart && (ch === '“' || ch === '”'))) {
        inString = false
        out += '"'
      } else if (ch === '"' || ch === '“' || ch === '”') out += ch
      else if (ch === '\n') out += '\\n'
      else if (ch === '\r') out += '\\r'
      else if (ch === '\t') out += '\\t'
      else out += ch
      continue
    }
    if (ch === '"' || ch === '“' || ch === '”') {
      inString = true
      isSmart = ch !== '"'
      out += '"'
    } else if (ch === ',') {
      // Drop a comma that only precedes a closing bracket.
      const rest = text.slice(i + 1).match(/^\s*([}\]])/)
      if (!rest) out += ch
    } else out += ch
  }
  return out
}

/** The end (exclusive) of the balanced {...} or [...] starting at `start`, or -1 when it never closes. */
function balancedEnd(text, start) {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Reads the extractor's reply into raw question objects: the whole reply, the
 * first balanced object holding "questions", and failing those, each complete
 * element of the "questions" array, so a reply cut off mid-way keeps the
 * questions that did arrive whole. Null when no "questions" array is found.
 * @param {string} reply
 * @returns {unknown[] | null}
 */
export function readQuestions(reply) {
  const text = repairJson(reply.replace(/```(?:json)?/g, ''))
  const whole = parseJson(text.trim())
  if (whole && Array.isArray(whole.questions)) return whole.questions

  for (let at = text.indexOf('{'); at >= 0; at = text.indexOf('{', at + 1)) {
    const end = balancedEnd(text, at)
    if (end < 0) break
    const found = parseJson(text.slice(at, end))
    if (found && Array.isArray(found.questions)) return found.questions
  }

  const key = text.search(/"questions"\s*:\s*\[/)
  if (key < 0) return null
  const items = []
  let at = text.indexOf('[', key) + 1
  for (;;) {
    const open = text.indexOf('{', at)
    if (open < 0) break
    const end = balancedEnd(text, open)
    if (end < 0) break
    const item = parseJson(text.slice(open, end))
    if (item !== undefined) items.push(item)
    at = end
  }
  return items
}

/**
 * The extractor's reply as dialog-ready questions, or null when it holds no "questions" array.
 * @param {string} text
 * @returns {AskQuestion[] | null}
 */
export function parseExtraction(text) {
  const raw = readQuestions(text)
  return raw === null ? null : normalizeQuestions(raw)
}

/**
 * Splits questions into dialogs of at most four.
 * @template T
 * @param {readonly T[]} items
 * @returns {T[][]}
 */
export function batches(items, size = MAX_QUESTIONS) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Reads one answer from the dialog's `answers` map (question text -> answer). */
export function answerFor(answers, question) {
  if (!answers || typeof answers !== 'object') return ''
  const value = answers[question]
  if (Array.isArray(value)) return value.map(str).filter(Boolean).join(', ')
  return str(value)
}

/**
 * Q/A blocks for every answered question; unanswered ones are left out.
 * @param {readonly AskQuestion[]} questions
 * @param {readonly string[]} answers
 */
export function compileAnswers(questions, answers) {
  return questions
    .map((q, i) => ({ q, a: (answers[i] ?? '').trim() }))
    .filter(({ a }) => a.length > 0)
    .map(({ q, a }) => `Q: ${q.question}\nA: ${a}`)
    .join('\n\n')
}
