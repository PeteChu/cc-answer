export type AnswerOption = { label: string; description?: string }

export type AnswerQuestion = {
  id: string
  header?: string
  question: string
  context?: string
  options: AnswerOption[]
}

export type AnswerResponse = {
  /** Indexes into the question's options that are picked. */
  selected: number[]
  /** Free-form text ("Other / custom answer"). */
  custom: string
  /** Multi-select (checkboxes) instead of single-select (radio). */
  isMulti: boolean
}

export type AnswerPhase = 'extracting' | 'answering' | 'review' | 'error'

export type AnswerSession = {
  /** The assistant reply the questions came from; a re-run on it restores the draft. */
  source: string
  phase: AnswerPhase
  error?: string
  questions: AnswerQuestion[]
  responses: AnswerResponse[]
  index: number
}

declare module 'claude-code' {
  interface PluginState {
    answer: { session: AnswerSession | null }
  }
}
