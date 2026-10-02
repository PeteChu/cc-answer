export type ProtoOption = { label: string; description?: string }

export type ProtoQuestion = {
  id: string
  header: string
  question: string
  multiSelect: boolean
  /** Empty for an open-ended question: answered by typing in the prompt. */
  options: ProtoOption[]
}

export type ProtoResponse = { selected: number[]; custom: string }

export type ProtoSession = {
  /** Which of the prototype designs draws the band, 1-based. */
  design: number
  source: 'demo' | 'live'
  questions: ProtoQuestion[]
  responses: ProtoResponse[]
  index: number
  phase: 'answering' | 'review'
}

declare module 'claude-code' {
  interface PluginState {
    answer: { proto: ProtoSession | null }
  }
}
