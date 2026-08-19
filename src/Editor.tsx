/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import { DownloadIcon, EyeIcon, ViewBoardsIcon } from '@heroicons/react/outline'
import { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import Button from './components/Button'
import Slider from './components/Slider'
import { downloadImage, loadImage, useImage, useWindowSize } from './utils'
import Progress from './components/Progress'
import { modelExists, downloadModel } from './adapters/cache'
import Modal from './components/Modal'
import { message } from './i18n'

interface EditorProps {
  file: File
}

interface Line {
  size?: number
  pts: { x: number; y: number }[]
  src: string
}

function createEmptyLine(): Line {
  return { pts: [], src: '' }
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: Line[],
  color = 'rgba(255, 0, 0, 0.5)'
) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  lines.forEach(line => {
    if (!line?.pts.length || !line.size) {
      return
    }
    ctx.lineWidth = line.size
    if (line.pts.length === 1) {
      ctx.beginPath()
      ctx.arc(line.pts[0].x, line.pts[0].y, line.size / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    ctx.beginPath()
    ctx.moveTo(line.pts[0].x, line.pts[0].y)
    line.pts.forEach(pt => {
      ctx.lineTo(pt.x, pt.y)
    })
    ctx.stroke()
  })
}

const BRUSH_HIDE_ON_SLIDER_CHANGE_TIMEOUT = 2000
export default function Editor(props: EditorProps) {
  const { file } = props
  const [brushSize, setBrushSize] = useState(40)
  const [original, isOriginalLoaded] = useImage(file)
  const [renders, setRenders] = useState<HTMLImageElement[]>([])
  const [context, setContext] = useState<CanvasRenderingContext2D>()
  const [maskCanvas] = useState<HTMLCanvasElement>(() => {
    return document.createElement('canvas')
  })
  const currentLineRef = useRef<Line>(createEmptyLine())
  const brushRef = useRef<HTMLDivElement>(null)
  const [showBrush, setShowBrush] = useState(false)
  const hideBrushTimeoutRef = useRef<number>()
  const [showOriginal, setShowOriginal] = useState(false)
  const [isInpaintingLoading, setIsProcessingLoading] = useState(false)
  const [generateProgress, setGenerateProgress] = useState(0)
  const modalRef = useRef(null)
  const separatorRef = useRef<HTMLDivElement>(null)
  const [useSeparator, setUseSeparator] = useState(false)
  const [separatorLeft, setSeparatorLeft] = useState(0)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const historyListRef = useRef<HTMLDivElement>(null)
  const scaledBrushSize = brushSize
  const canvasDiv = useRef<HTMLDivElement>(null)
  const [downloaded, setDownloaded] = useState(true)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const progressTimerRef = useRef<number>()
  const mountedRef = useRef(true)
  const windowSize = useWindowSize()

  const onloading = useCallback(() => {
    setIsProcessingLoading(true)
    setGenerateProgress(0)
    window.clearInterval(progressTimerRef.current)
    const progressTimer = window.setInterval(() => {
      setGenerateProgress(p => {
        if (p < 90) return Math.min(90, p + 10 * Math.random())
        if (p < 99) return Math.min(99, p + Math.random())
        // Do not hide the progress bar after 99%,cause sometimes long time progress
        // window.setTimeout(() => setIsInpaintingLoading(false), 500)
        return p
      })
    }, 1000)
    progressTimerRef.current = progressTimer
    return {
      close: () => {
        window.clearInterval(progressTimer)
        if (progressTimerRef.current === progressTimer) {
          progressTimerRef.current = undefined
        }
        if (mountedRef.current) {
          setGenerateProgress(100)
          setIsProcessingLoading(false)
        }
      },
    }
  }, [])

  useEffect(
    () => () => {
      mountedRef.current = false
      window.clearInterval(progressTimerRef.current)
      window.clearTimeout(hideBrushTimeoutRef.current)
    },
    []
  )

  const draw = useCallback(
    (index = -1) => {
      if (!context) {
        return
      }
      context.clearRect(0, 0, context.canvas.width, context.canvas.height)
      const currRender =
        renders[index === -1 ? renders.length - 1 : index] ?? original
      const { canvas } = context

      const canvasContainer = canvasDiv.current
      if (!canvasContainer) {
        return
      }
      const divWidth = canvasContainer.offsetWidth
      const divHeight = canvasContainer.offsetHeight
      if (!currRender.width || !currRender.height || !divWidth || !divHeight) {
        return
      }

      // 计算宽高比
      const imgAspectRatio = currRender.width / currRender.height
      const divAspectRatio = divWidth / divHeight

      let canvasWidth: number
      let canvasHeight: number

      // 比较宽高比以决定如何缩放
      if (divAspectRatio > imgAspectRatio) {
        // div 较宽，基于高度缩放
        canvasHeight = divHeight
        canvasWidth = currRender.width * (divHeight / currRender.height)
      } else {
        // div 较窄，基于宽度缩放
        canvasWidth = divWidth
        canvasHeight = currRender.height * (divWidth / currRender.width)
      }

      const width = Math.max(1, Math.round(canvasWidth))
      const height = Math.max(1, Math.round(canvasHeight))
      canvas.width = width
      canvas.height = height
      setCanvasSize(current =>
        current.width === width && current.height === height
          ? current
          : { width, height }
      )

      if (currRender?.src) {
        context.drawImage(currRender, 0, 0, canvas.width, canvas.height)
      } else {
        context.drawImage(original, 0, 0, canvas.width, canvas.height)
      }
      drawLines(context, [currentLineRef.current])
    },
    [context, original, renders]
  )

  const refreshCanvasMask = useCallback(() => {
    if (!context?.canvas.width || !context?.canvas.height) {
      throw new Error('canvas has invalid size')
    }
    maskCanvas.width = context?.canvas.width
    maskCanvas.height = context?.canvas.height
    const ctx = maskCanvas.getContext('2d')
    if (!ctx) {
      throw new Error('could not retrieve mask canvas')
    }
    drawLines(ctx, [currentLineRef.current], 'white')
  }, [context?.canvas.height, context?.canvas.width, maskCanvas])

  // Draw once the original image is loaded
  useEffect(() => {
    if (!context?.canvas) {
      return
    }
    if (isOriginalLoaded && windowSize.width > 0 && windowSize.height > 0) {
      draw()
    }
  }, [context?.canvas, draw, isOriginalLoaded, windowSize])

  // Handle mouse interactions
  useEffect(() => {
    const canvas = context?.canvas
    if (!canvas) {
      return
    }
    let activePointerId: number | null = null

    const updateBrushPosition = (ev: PointerEvent) => {
      if (brushRef.current) {
        const x = ev.clientX - scaledBrushSize / 2
        const y = ev.clientY - scaledBrushSize / 2

        brushRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`
      }
    }
    const getCanvasPoint = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: (ev.clientX - rect.left) * (canvas.width / rect.width),
        y: (ev.clientY - rect.top) * (canvas.height / rect.height),
      }
    }
    const onPaint = (px: number, py: number) => {
      currentLineRef.current.pts.push({ x: px, y: py })
      draw()
    }
    const onPointerMove = (ev: PointerEvent) => {
      updateBrushPosition(ev)
      if (activePointerId !== ev.pointerId) {
        return
      }
      ev.preventDefault()
      const point = getCanvasPoint(ev)
      onPaint(point.x, point.y)
    }

    const processStroke = async () => {
      if (!original.src || showOriginal) {
        return
      }
      if (!currentLineRef.current.pts.length) {
        return
      }
      const loading = onloading()
      try {
        refreshCanvasMask()
        const start = Date.now()
        console.log('inpaint_start')
        // each time based on the last result, the first is the original
        const newFile = renders.slice(-1)[0] ?? file
        const { default: inpaint } = await import('./adapters/inpainting')
        const res = await inpaint(newFile, maskCanvas.toDataURL())
        if (!res) {
          throw new Error('empty response')
        }
        // TODO: fix the render if it failed loading
        const newRender = new Image()
        newRender.dataset.id = Date.now().toString()
        await loadImage(newRender, res)
        if (!mountedRef.current) return
        currentLineRef.current = createEmptyLine()
        setRenders(current => [...current, newRender])
        console.log('inpaint_processed', {
          duration: Date.now() - start,
        })
      } catch (error) {
        console.log('inpaint_failed', {
          error,
        })
        if (mountedRef.current) {
          currentLineRef.current = createEmptyLine()
          draw()
          alert(error instanceof Error ? error.message : String(error))
        }
      } finally {
        loading.close()
      }
    }
    const onPointerStart = (ev: PointerEvent) => {
      if (
        !original.src ||
        showOriginal ||
        (ev.pointerType === 'mouse' && ev.button !== 0)
      ) {
        return
      }
      ev.preventDefault()
      activePointerId = ev.pointerId
      canvas.setPointerCapture(ev.pointerId)
      currentLineRef.current.size = brushSize
      const point = getCanvasPoint(ev)
      onPaint(point.x, point.y)
    }
    const onPointerUp = (ev: PointerEvent) => {
      if (activePointerId !== ev.pointerId) {
        return
      }
      activePointerId = null
      if (canvas.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId)
      }
      void processStroke()
    }
    const onPointerCancel = (ev: PointerEvent) => {
      if (activePointerId !== ev.pointerId) {
        return
      }
      activePointerId = null
      if (canvas.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId)
      }
      currentLineRef.current = createEmptyLine()
      draw()
    }

    const onPointerEnter = () => {
      window.clearTimeout(hideBrushTimeoutRef.current)
      setShowBrush(!showOriginal)
    }
    const onPointerLeave = () => setShowBrush(false)

    canvas.addEventListener('pointerdown', onPointerStart)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('pointerenter', onPointerEnter)
    canvas.addEventListener('pointerleave', onPointerLeave)

    return () => {
      canvas.removeEventListener('pointerdown', onPointerStart)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerenter', onPointerEnter)
      canvas.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [
    brushSize,
    context,
    file,
    draw,
    refreshCanvasMask,
    maskCanvas,
    original.src,
    renders,
    showOriginal,
    onloading,
    scaledBrushSize,
  ])

  useEffect(() => {
    if (!renders.length) return
    const frame = window.requestAnimationFrame(() => {
      if (!historyListRef.current) return
      historyListRef.current.scrollTo({
        left: historyListRef.current.scrollWidth,
        behavior: 'smooth',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [renders.length])

  useEffect(() => {
    setSeparatorLeft(current => Math.min(current, canvasSize.width))
  }, [canvasSize.width])

  const moveSeparator = useCallback(
    (clientX: number) => {
      const rect = context?.canvas.getBoundingClientRect()
      if (!rect) return
      setSeparatorLeft(Math.min(rect.width, Math.max(0, clientX - rect.left)))
    },
    [context]
  )

  const onSeparatorPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setUseSeparator(true)
    moveSeparator(event.clientX)
  }

  const onSeparatorPointerMove = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!useSeparator) return
    event.preventDefault()
    moveSeparator(event.clientX)
  }

  const onSeparatorPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setUseSeparator(false)
  }

  function download() {
    const currRender = renders.at(-1) ?? original
    const source = currRender.currentSrc || currRender.src
    downloadImage(source, renders.length ? 'inpaint-result.png' : file.name)
  }

  const undo = useCallback(() => {
    currentLineRef.current = createEmptyLine()
    setRenders(current => current.slice(0, -1))
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!renders.length) {
        return
      }
      const isCmdZ = (event.metaKey || event.ctrlKey) && event.key === 'z'
      if (isCmdZ) {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
    }
  }, [renders, undo])

  const backTo = useCallback((index: number) => {
    currentLineRef.current = createEmptyLine()
    setRenders(current => current.slice(0, index + 1))
  }, [])

  const History = useMemo(
    () =>
      renders.map((render, index) => {
        return (
          <div
            key={render.dataset.id}
            style={{
              position: 'relative',
              display: 'inline-block',
              flexShrink: 0,
            }}
          >
            <img
              src={render.src}
              alt="render"
              className="rounded-sm"
              style={{
                height: '90px',
              }}
            />
            <Button
              ariaLabel={message('back_here')}
              className="cursor-pointer rounded-sm opacity-100 sm:opacity-0 sm:hover:opacity-100 sm:focus-visible:opacity-100"
              style={{
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={() => backTo(index)}
              onEnter={() => draw(index)}
              onLeave={draw}
            >
              <div
                style={{
                  color: '#fff',
                  fontSize: '12px',
                  textAlign: 'center',
                }}
              >
                {message('back_here')}
              </div>
            </Button>
          </div>
        )
      }),
    [renders, backTo, draw]
  )

  const handleSliderStart = () => {
    setShowBrush(true)
  }
  const handleSliderChange = (sliderValue: number) => {
    if (brushRef.current) {
      const x = document.documentElement.clientWidth / 2 - sliderValue / 2
      const y = document.documentElement.clientHeight / 2 - sliderValue / 2

      brushRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }
    setBrushSize(sliderValue)
    window.clearTimeout(hideBrushTimeoutRef.current)
    hideBrushTimeoutRef.current = window.setTimeout(() => {
      setShowBrush(false)
    }, BRUSH_HIDE_ON_SLIDER_CHANGE_TIMEOUT)
  }

  const onSuperResolution = useCallback(async () => {
    try {
      if (!(await modelExists('superResolution'))) {
        if (!mountedRef.current) return
        setDownloaded(false)
        await downloadModel('superResolution', progress => {
          if (mountedRef.current) setDownloadProgress(progress)
        })
      }
      if (!mountedRef.current) return
      setDownloaded(true)
      setGenerateProgress(0)
      setIsProcessingLoading(true)
      // 运行
      const start = Date.now()
      console.log('superResolution_start')
      // each time based on the last result, the first is the original
      const newFile = renders.at(-1) ?? file
      const { default: superResolution } =
        await import('./adapters/superResolution')
      const res = await superResolution(newFile, progress => {
        if (mountedRef.current) setGenerateProgress(progress)
      })
      if (!res) {
        throw new Error('empty response')
      }
      // TODO: fix the render if it failed loading
      const newRender = new Image()
      newRender.dataset.id = Date.now().toString()
      await loadImage(newRender, res)
      if (!mountedRef.current) return
      currentLineRef.current = createEmptyLine()
      setRenders(current => [...current, newRender])
      console.log('superResolution_processed', {
        duration: Date.now() - start,
      })

      // 替换当前图片
    } catch (error) {
      console.error('superResolution', error)
      if (mountedRef.current) {
        alert(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (mountedRef.current) {
        setDownloaded(true)
        setIsProcessingLoading(false)
      }
    }
  }, [file, renders])

  return (
    <div
      className={[
        'editor-shell theme-surface flex h-full min-h-0 flex-col items-center overflow-hidden bg-canvas px-3 sm:px-6',
        isInpaintingLoading ? 'animate-pulse-fast pointer-events-none' : '',
      ].join(' ')}
    >
      {/* History */}
      {renders.length > 0 && (
        <div
          ref={historyListRef}
          className={[
            'theme-surface history-scrollbar mt-3 flex h-28 w-full max-w-5xl flex-none flex-row items-center gap-4 overflow-x-auto rounded-2xl border border-line bg-panel p-3 shadow-sm',
          ].join(' ')}
        >
          {History}
        </div>
      )}
      {/* 画图 */}
      <div
        className={[
          'relative flex min-h-0 w-full max-w-[min(92vw,90rem)] flex-1 items-center justify-center py-3',
        ].join(' ')}
        ref={canvasDiv}
      >
        <div className="relative flex items-center justify-center">
          <canvas
            className="touch-none rounded-xl shadow-2xl shadow-black/20"
            style={showBrush ? { cursor: 'none' } : {}}
            ref={r => {
              if (r && !context) {
                const ctx = r.getContext('2d')
                if (ctx) {
                  setContext(ctx)
                }
              }
            }}
          />
          <div
            className={[
              'absolute top-0 right-0 pointer-events-none',
              showOriginal ? '' : 'overflow-hidden',
            ].join(' ')}
            style={{
              width: showOriginal ? `${canvasSize.width}px` : '0px',
              height: canvasSize.height,
              transitionProperty: 'width, height',
              transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
              transitionDuration: '300ms',
            }}
          >
            <div
              className={[
                'absolute top-0 right-0 pointer-events-none z-10',
                useSeparator
                  ? 'bg-ink text-canvas'
                  : 'bg-primary text-primary-ink',
                'w-1',
                'flex items-center justify-center',
                'separator',
              ].join(' ')}
              style={{
                left: `${separatorLeft}px`,
                height: canvasSize.height,
                transitionProperty: 'width, height',
                transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
                transitionDuration: '300ms',
              }}
            >
              <span className="absolute bottom-0 left-2 rounded-lg bg-black/60 px-2 py-1 text-xs font-bold text-white select-none">
                original
              </span>
              <div
                className={[
                  'theme-control pointer-events-auto absolute rounded-xl px-1 py-3 shadow-lg',
                  useSeparator
                    ? 'bg-ink text-canvas'
                    : 'bg-primary text-primary-ink',
                ].join(' ')}
                style={{ cursor: 'ew-resize' }}
                ref={separatorRef}
                onPointerDown={onSeparatorPointerDown}
                onPointerMove={onSeparatorPointerMove}
                onPointerUp={onSeparatorPointerEnd}
                onPointerCancel={onSeparatorPointerEnd}
              >
                <ViewBoardsIcon
                  className="w-5 h-5"
                  style={{ cursor: 'ew-resize' }}
                />
              </div>
            </div>
            <img
              className="absolute right-0"
              src={original.src}
              alt="original"
              width={canvasSize.width}
              height={canvasSize.height}
              style={{
                width: `${canvasSize.width}px`,
                height: `${canvasSize.height}px`,
                maxWidth: 'none',
                clipPath: `inset(0 0 0 ${separatorLeft}px)`,
              }}
            />
          </div>
          {isInpaintingLoading && (
            <div className="theme-surface absolute inset-0 z-10 flex h-full w-full items-center justify-center rounded-xl bg-panel/90 backdrop-blur-sm">
              <div
                ref={modalRef}
                className="w-4/5 space-y-4 text-center sm:w-1/2"
              >
                <p className="text-lg font-black">{message('processing')}</p>
                <p className="text-sm text-muted">
                  {message('processing_description')}
                </p>
                <Progress percent={generateProgress} />
              </div>
            </div>
          )}
        </div>
      </div>

      {!downloaded && (
        <Modal ariaLabel={message('upscaleing_model_download_message')}>
          <div className="space-y-5">
            <p className="text-lg font-bold leading-7">
              {message('upscaleing_model_download_message')}
            </p>
            <Progress percent={downloadProgress} />
          </div>
        </Modal>
      )}
      {showBrush && (
        <div
          className="fixed left-0 top-0 rounded-full border border-white/50 bg-red-500/45 shadow-[0_0_0_1px_rgba(0,0,0,0.25)] pointer-events-none"
          style={{
            width: `${scaledBrushSize}px`,
            height: `${scaledBrushSize}px`,
            transform: `translate3d(-100px, -100px, 0)`,
          }}
          ref={brushRef}
        />
      )}
      {/* 工具栏 */}
      <div
        className={[
          'toolbar-enter theme-surface mb-3 grid w-full max-w-5xl flex-none grid-cols-2 items-center gap-2 rounded-2xl border border-line bg-panel/95 p-3 shadow-xl backdrop-blur-xl',
          'sm:flex sm:flex-row sm:justify-between sm:gap-3',
        ].join(' ')}
      >
        {renders.length > 0 && (
          <Button
            primary
            className="w-full sm:w-auto"
            onClick={undo}
            icon={
              <svg
                aria-hidden="true"
                className="w-6 h-6"
                width="19"
                height="9"
                viewBox="0 0 19 9"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M2 1C2 0.447715 1.55228 0 1 0C0.447715 0 0 0.447715 0 1H2ZM1 8H0V9H1V8ZM8 9C8.55228 9 9 8.55229 9 8C9 7.44771 8.55228 7 8 7V9ZM16.5963 7.42809C16.8327 7.92721 17.429 8.14016 17.9281 7.90374C18.4272 7.66731 18.6402 7.07103 18.4037 6.57191L16.5963 7.42809ZM16.9468 5.83205L17.8505 5.40396L16.9468 5.83205ZM0 1V8H2V1H0ZM1 9H8V7H1V9ZM1.66896 8.74329L6.66896 4.24329L5.33104 2.75671L0.331035 7.25671L1.66896 8.74329ZM16.043 6.26014L16.5963 7.42809L18.4037 6.57191L17.8505 5.40396L16.043 6.26014ZM6.65079 4.25926C9.67554 1.66661 14.3376 2.65979 16.043 6.26014L17.8505 5.40396C15.5805 0.61182 9.37523 -0.710131 5.34921 2.74074L6.65079 4.25926Z"
                  fill="currentColor"
                />
              </svg>
            }
          >
            {message('undo')}
          </Button>
        )}
        <div className="col-span-2 flex justify-center sm:contents">
          <Slider
            label={message('bruch_size')}
            min={10}
            max={200}
            value={brushSize}
            onChange={handleSliderChange}
            onStart={handleSliderStart}
          />
        </div>
        <Button
          primary={showOriginal}
          className="w-full sm:w-auto"
          icon={<EyeIcon className="w-6 h-6" />}
          onClick={() => {
            setShowOriginal(!showOriginal)
            setSeparatorLeft(0)
          }}
        >
          {message('original')}
        </Button>
        {!showOriginal && (
          <Button className="w-full sm:w-auto" onClick={onSuperResolution}>
            {message('upscale')}
          </Button>
        )}

        <Button
          primary
          className="col-span-2 w-full sm:w-auto"
          icon={<DownloadIcon className="w-6 h-6" />}
          onClick={download}
        >
          {message('download')}
        </Button>
      </div>
    </div>
  )
}
