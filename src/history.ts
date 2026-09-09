export const HISTORY_MAX_STEPS = 20
export const HISTORY_MAX_BYTES = 128 * 1024 * 1024

export interface EditHistory<T> {
  entries: T[]
  // -1 selects the original image, which is kept outside the result history.
  index: number
  evicted?: number
}

export type HistoryAction<T> =
  | { type: 'append'; entry: T; sizeOf?: (entry: T) => number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; index: number }

export function historyReducer<T>(
  state: EditHistory<T>,
  action: HistoryAction<T>
): EditHistory<T> {
  switch (action.type) {
    case 'append': {
      const entries = [...state.entries.slice(0, state.index + 1), action.entry]
      let removed = 0
      const sizeOf = action.sizeOf ?? (() => 0)
      let bytes = entries.reduce((sum, entry) => sum + sizeOf(entry), 0)
      while (
        entries.length > 1 &&
        (entries.length > HISTORY_MAX_STEPS || bytes > HISTORY_MAX_BYTES)
      ) {
        bytes -= sizeOf(entries[0])
        entries.shift()
        removed++
      }
      const next = { entries, index: entries.length - 1 }
      return removed || state.evicted
        ? { ...next, evicted: (state.evicted ?? 0) + removed }
        : next
    }
    case 'undo':
      return state.index >= 0 ? { ...state, index: state.index - 1 } : state
    case 'redo':
      return state.index < state.entries.length - 1
        ? { ...state, index: state.index + 1 }
        : state
    case 'select':
      return Number.isInteger(action.index) &&
        action.index >= -1 &&
        action.index < state.entries.length &&
        action.index !== state.index
        ? { ...state, index: action.index }
        : state
  }
}
