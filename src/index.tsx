import ReactDOM from 'react-dom'
import './index.css'
import App from './App'
import { loadingOnnxruntime } from './adapters/util'

const root = document.getElementById('root')

async function bootstrap() {
  await loadingOnnxruntime()
  ReactDOM.render(<App />, root)
}

void bootstrap().catch(error => {
  const isChinese = navigator.language.toLowerCase().startsWith('zh')
  ReactDOM.render(
    <main className="theme-surface flex h-full min-h-screen items-center justify-center bg-canvas p-6 text-ink">
      <div className="w-full max-w-lg space-y-5 rounded-3xl border border-line bg-panel p-8 shadow-2xl">
        <h1 className="text-2xl font-black">
          {isChinese ? '运行组件加载失败' : 'Runtime failed to load'}
        </h1>
        <p className="break-words text-sm leading-6 text-muted">
          {error instanceof Error ? error.message : String(error)}
        </p>
        <button
          type="button"
          className="theme-control min-h-10 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-ink"
          onClick={() => window.location.reload()}
        >
          {isChinese ? '重试' : 'Retry'}
        </button>
      </div>
    </main>,
    root
  )
})
