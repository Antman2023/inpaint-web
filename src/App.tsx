/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable jsx-a11y/control-has-associated-label */
import {
  ArrowLeftIcon,
  InformationCircleIcon,
  MoonIcon,
  SunIcon,
} from '@heroicons/react/outline'
import { lazy, Suspense, useEffect, useState } from 'react'
import Button from './components/Button'
import FileSelect from './components/FileSelect'
import EditorBoundary from './components/EditorBoundary'
import Modal from './components/Modal'
import { type LanguageTag, languageTag, message, setLanguageTag } from './i18n'
import { useTheme } from './theme'
import RepairRuntime from './components/RepairRuntime'
import { createImageImporter, type ImageImportState } from './imageImport'

const EXAMPLE_IMAGES = ['bag', 'dog', 'car', 'bird', 'jacket', 'shoe', 'paris']
const Editor = lazy(() => import('./Editor'))

function App() {
  const [imageImport, setImageImport] = useState<ImageImportState>({
    status: 'idle',
  })
  const [importer] = useState(() => createImageImporter(setImageImport))
  const file = imageImport.status === 'ready' ? imageImport.file : undefined
  useEffect(() => () => importer.dispose(), [importer])
  const [stateLanguageTag, setStateLanguageTag] =
    useState<LanguageTag>(languageTag())

  const [showAbout, setShowAbout] = useState(false)

  const { theme, toggleTheme } = useTheme()

  useEffect(() => {
    document.documentElement.lang = stateLanguageTag === 'zh' ? 'zh-CN' : 'en'
  }, [stateLanguageTag])

  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (
        event.defaultPrevented ||
        !event.dataTransfer?.types.includes('Files')
      )
        return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', preventFileNavigation)
    window.addEventListener('drop', preventFileNavigation)
    return () => {
      window.removeEventListener('dragover', preventFileNavigation)
      window.removeEventListener('drop', preventFileNavigation)
    }
  }, [])

  return (
    <div className="app-shell theme-surface flex min-h-full flex-col bg-canvas text-ink">
      <header className="app-header theme-surface z-30 grid h-16 flex-none grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-panel/90 px-2 backdrop-blur-xl sm:px-4">
        <div className="flex min-w-0 justify-start">
          <Button
            disabled={imageImport.status === 'idle'}
            ariaLabel={message('start_new')}
            className="!px-2 sm:!px-3"
            icon={<ArrowLeftIcon className="h-5 w-5" />}
            onClick={importer.cancel}
          >
            <span className="hidden sm:inline">{message('start_new')}</span>
          </Button>
        </div>

        <button
          type="button"
          onClick={importer.cancel}
          className="theme-control min-w-0 justify-self-center whitespace-nowrap rounded-lg px-1 text-lg font-black tracking-[-0.04em] text-ink sm:px-2 sm:text-2xl"
        >
          Inpaint<span className="text-primary">—web</span>
        </button>

        <div className="flex min-w-0 items-center justify-end gap-1">
          <Button
            ariaLabel={
              theme === 'dark'
                ? message('theme_to_light')
                : message('theme_to_dark')
            }
            className="!h-10 !w-10 !px-0"
            icon={
              theme === 'dark' ? (
                <SunIcon className="h-5 w-5" />
              ) : (
                <MoonIcon className="h-5 w-5" />
              )
            }
            onClick={toggleTheme}
          >
            <span className="sr-only">
              {theme === 'dark'
                ? message('theme_to_light')
                : message('theme_to_dark')}
            </span>
          </Button>
          <Button
            ariaLabel={
              stateLanguageTag === 'en' ? '切换到中文' : 'Switch to English'
            }
            className="!h-10 !min-w-10 !px-2 uppercase"
            onClick={() => {
              const nextLanguageTag = stateLanguageTag === 'zh' ? 'en' : 'zh'
              setLanguageTag(nextLanguageTag)
              setStateLanguageTag(nextLanguageTag)
            }}
          >
            {stateLanguageTag === 'en' ? '中' : 'EN'}
          </Button>
          <Button
            ariaLabel={message('feedback')}
            className="!h-10 !w-10 !px-0"
            icon={<InformationCircleIcon className="h-5 w-5" />}
            onClick={() => setShowAbout(true)}
          >
            <span className="sr-only">{message('feedback')}</span>
          </Button>
        </div>
      </header>

      <main className="relative h-[calc(100svh-4rem)] min-h-0">
        {file ? (
          <EditorBoundary onReset={importer.cancel}>
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm font-bold text-muted">
                  {stateLanguageTag === 'zh'
                    ? '正在加载编辑器…'
                    : 'Loading editor…'}
                </div>
              }
            >
              <Editor file={file} />
            </Suspense>
          </EditorBoundary>
        ) : (
          <section className="workspace-enter mx-auto flex h-full w-full max-w-6xl flex-col justify-center overflow-y-auto px-4 py-6 sm:px-8 sm:py-10">
            <div className="mx-auto mb-6 max-w-2xl text-center sm:mb-8">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-primary sm:text-sm">
                {message('workspace_eyebrow')}
              </p>
              <h1 className="mt-3 text-2xl font-black tracking-[-0.035em] text-ink sm:text-4xl">
                {message('workspace_title')}
              </h1>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted sm:text-base">
                {message('workspace_description')}
              </p>
            </div>

            <div className="mx-auto h-[clamp(15rem,34svh,21rem)] w-full max-w-3xl">
              <FileSelect
                busy={imageImport.status === 'loading'}
                onSelection={f => {
                  void importer.load(f)
                }}
              />
            </div>

            {imageImport.status === 'loading' && (
              <div className="mx-auto mt-3 flex items-center gap-3 text-sm text-muted">
                <p role="status">{message('image_import_loading')}</p>
                <Button onClick={importer.cancel}>{message('cancel')}</Button>
              </div>
            )}
            {imageImport.status === 'error' && (
              <div
                role="alert"
                className="mx-auto mt-3 max-w-3xl text-center text-sm text-muted"
              >
                <p className="font-semibold text-ink">
                  {message('image_import_failed')}
                </p>
                <p className="mt-1 break-words">{imageImport.error}</p>
              </div>
            )}

            <div className="mx-auto mt-7 w-full max-w-5xl sm:mt-9">
              <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.18em] text-muted">
                {message('try_it_images')}
              </p>
              <div className="history-scrollbar -mt-2 flex snap-x gap-3 overflow-x-auto px-[calc(50%_-_2.75rem)] pt-2 pb-3 sm:justify-center sm:px-0">
                {EXAMPLE_IMAGES.map(image => (
                  <button
                    type="button"
                    key={image}
                    onClick={() => {
                      void importer.load(
                        `${import.meta.env.BASE_URL}examples/${image}.jpeg`
                      )
                    }}
                    className="sample-button theme-control h-20 w-24 flex-none snap-center overflow-hidden rounded-2xl border border-line bg-panel shadow-sm sm:h-24 sm:w-28"
                  >
                    <img
                      className="h-full w-full object-cover"
                      src={`${import.meta.env.BASE_URL}examples/${image}.jpeg`}
                      alt={image}
                    />
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {showAbout && (
        <Modal
          ariaLabel={message('feedback')}
          onClose={() => setShowAbout(false)}
        >
          <div className="space-y-4">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">
              Inpaint—web
            </p>
            <h2 className="text-2xl font-black tracking-tight">
              {message('feedback')}
            </h2>
            <p className="leading-7 text-muted">
              {stateLanguageTag === 'zh'
                ? '如果遇到问题或有功能建议，欢迎前往 GitHub 反馈。'
                : 'Questions or feature ideas are welcome on GitHub.'}{' '}
              <a
                href="https://github.com/Antman2023/inpaint-web"
                className="font-bold text-ink underline decoration-primary decoration-2 underline-offset-4"
                rel="noreferrer"
                target="_blank"
              >
                GitHub
              </a>
            </p>
            <RepairRuntime onRepaired={() => setShowAbout(false)} />
          </div>
        </Modal>
      )}
    </div>
  )
}

export default App
