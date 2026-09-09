import { Component, type ReactNode } from 'react'
import { message } from '../i18n'
import Button from './Button'

export default class EditorBoundary extends Component<{
  children: ReactNode
  onReset: () => void
}> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto p-6">
        <section className="w-full max-w-lg space-y-4 text-center">
          <h1 role="alert" className="text-xl font-bold">
            {message('editor_unavailable')}
          </h1>
          <p className="text-sm leading-6 text-muted">
            {message('editor_unavailable_hint')}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button primary onClick={() => window.location.reload()}>
              {message('reload_page')}
            </Button>
            <Button onClick={this.props.onReset}>{message('start_new')}</Button>
          </div>
        </section>
      </div>
    )
  }
}
