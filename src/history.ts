export interface EditHistory<T> {
  entries: T[]
  // -1 selects the original image, which is kept outside the result history.
  index: number
}

export type HistoryAction<T> =
  | { type: 'append'; entry: T }
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
      return { entries, index: entries.length - 1 }
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
