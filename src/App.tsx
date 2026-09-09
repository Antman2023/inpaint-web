/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable jsx-a11y/control-has-associated-label */
import {
  ArrowLeftIcon,
  InformationCircleIcon,
  MoonIcon,
  SunIcon,
} from '@heroicons/react/outline'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import Button from './components/Button'
import FileSelect from './components/FileSelect'
import Modal from './components/Modal'
import { resizeImageFile, useClickAway } from './utils'
import Progress from './components/Progress'
import { downloadModel } from './adapters/cache'
import { type LanguageTag, languageTag, message, setLanguageTag } from './i18n'
import { useTheme } from './theme'
import RepairRuntime from './components/RepairRuntime'

const EXAMPLE_IMAGES = ['bag', 'dog', 'car', 'bird', 'jacket', 'shoe', 'paris']
const Editor = lazy(() => import('./Editor'))

function App() {
  const [file, setFile] = useState<File>()
  const [stateLanguageTag, setStateLanguageTag] =
    useState<LanguageTag>(languageTag())

  const [showAbout, setShowAbout] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  const [downloadProgress, setDownloadProgress] = useState(100)
  const [modelDownloadError, setModelDownloadError] = useState<string>()
  const { theme, toggleTheme } = useTheme()

  function preloadInpaintModel() {
    setModelDownloadError(undefined)
    void downloadModel('inpaint', setDownloadProgress).catch(error => {
      setDownloadProgress(100)
      setModelDownloadError(
        error instanceof Error ? error.message : String(error)
      )
    })
  }

  useEffect(preloadInpaintModel, [])

  useEffect(() => {
    document.documentElement.lang = stateLanguageTag === 'zh' ? 'zh-CN' : 'en'
  }, [stateLanguageTag])

  useClickAway(modalRef, () => {
    setShowAbout(false)
  })

  useEffect(() => {
    if (!showAbout) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowAbout(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [showAbout])

  async function startWithDemoImage(img: string) {
    const response = await fetch(`/examples/${img}.jpeg`)
    if (!response.ok) {
      throw new Error(`${message('example_load_failed')} (${response.status})`)
    }
    const imgBlob = await response.blob()
    setFile(new File([imgBlob], `${img}.jpeg`, { type: 'image/jpeg' }))
  }

  return (
    <div className="app-shell theme-surface flex min-h-full flex-col bg-canvas text-ink">
      <header className="app-header theme-surface z-30 grid h-16 flex-none grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-panel/90 px-2 backdrop-blur-xl sm:px-4">
        <div className="flex min-w-0 justify-start">
          <Button
            disabled={!file}
            ariaLabel={message('start_new')}
            className="!px-2 sm:!px-3"
            icon={<ArrowLeftIcon className="h-5 w-5" />}
            onClick={() => setFile(undefined)}
          >
            <span className="hidden sm:inline">{message('start_new')}</span>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setFile(undefined)}
          className="theme-control rounded-lg px-2 text-xl font-black tracking-[-0.04em] text-ink sm:text-2xl"
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
                onSelection={async f => {
                  const { file: resizedFile } = await resizeImageFile(
                    f,
                    1024 * 4
                  )
                  setFile(resizedFile)
                }}
              />
            </div>

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
                      void startWithDemoImage(image).catch(error => {
                        alert(
                          error instanceof Error ? error.message : String(error)
                        )
                      })
                    }}
                    className="sample-button theme-control h-20 w-24 flex-none snap-center overflow-hidden rounded-2xl border border-line bg-panel shadow-sm sm:h-24 sm:w-28"
                  >
                    <img
                      className="h-full w-full object-cover"
                      src={`examples/${image}.jpeg`}
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
        <Modal ariaLabel={message('feedback')}>
          <div ref={modalRef} className="space-y-4">
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
            <RepairRuntime />
          </div>
        </Modal>
      )}
      {!(downloadProgress === 100) && (
        <Modal ariaLabel={message('inpaint_model_download_message')}>
          <div className="space-y-5">
            <p className="text-lg font-bold leading-7">
              {message('inpaint_model_download_message')}
            </p>
            <Progress percent={downloadProgress} />
          </div>
        </Modal>
      )}
      {modelDownloadError && (
        <Modal
          ariaLabel={
            stateLanguageTag === 'zh' ? '模型下载失败' : 'Model download failed'
          }
        >
          <div className="space-y-5">
            <h2 className="text-xl font-black">
              {stateLanguageTag === 'zh'
                ? '模型下载失败'
                : 'Model download failed'}
            </h2>
            <p className="break-words text-sm leading-6 text-muted">
              {modelDownloadError}
            </p>
            <Button primary onClick={preloadInpaintModel}>
              {stateLanguageTag === 'zh' ? '重试' : 'Retry'}
            </Button>
            <RepairRuntime
              onRepaired={() => setModelDownloadError(undefined)}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}

export default App
