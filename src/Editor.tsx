/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import { DownloadIcon, EyeIcon, ReplyIcon } from '@heroicons/react/outline'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useMemo,
  useReducer,
} from 'react'
import Button from './components/Button'
import Slider from './components/Slider'
import { downloadImage, imageFileName, loadImage, useImage } from './utils'
import Progress from './components/Progress'
import { modelExists, downloadModel } from './adapters/cache'
import Modal from './components/Modal'
import { message } from './i18n'
import type { InpaintStage } from './adapters/inpainting'
import { warmupInpaint } from './adapters/runtime'
import type { UpscaleStatus } from './adapters/superResolution'
import { historyReducer } from './history'
import { getUpscalePlan } from './imageSize'
import RepairRuntime from './components/RepairRuntime'
import ImageComparison from './components/ImageComparison'
import { type BrushStroke, drawStroke } from './brush'

interface EditorProps {
  file: File
}

function createEmptyLine(): BrushStroke {
  return { pts: [] }
}

const BRUSH_HIDE_ON_SLIDER_CHANGE_TIMEOUT = 2000
export default function Editor(props: EditorProps) {
  const { file } = props
  const [lifetime] = useState(() => new AbortController())
  useEffect(() => {
    // Prepare while the user positions the image and paints the mask.
    void warmupInpaint(lifetime.signal).catch(error => {
      if (!lifetime.signal.aborted) console.warn('Model warmup failed', error)
    })
  }, [lifetime])
  const [brushSize, setBrushSize] = useState(40)
  const [original, isOriginalLoaded, imageError, retryImage] = useImage(file)
  const [history, dispatchHistory] = useReducer(
    historyReducer<HTMLImageElement>,
    {
      entries: [],
      index: -1,
    }
  )
  const currentRender = history.entries[history.index]
  const sourceImage = currentRender ?? original
  const upscalePlan = getUpscalePlan(
    sourceImage.naturalWidth,
    sourceImage.naturalHeight
  )
  const canUndo = history.index >= 0
  const canRedo = history.index < history.entries.length - 1
  const [context, setContext] = useState<CanvasRenderingContext2D>()
  const [maskCanvas] = useState<HTMLCanvasElement>(() => {
    return document.createElement('canvas')
  })
  const currentLineRef = useRef<BrushStroke>(createEmptyLine())
  const brushRef = useRef<HTMLDivElement>(null)
  const [showBrush, setShowBrush] = useState(false)
  const hideBrushTimeoutRef = useRef<number>()
  const [showOriginal, setShowOriginal] = useState(false)
  const [isInpaintingLoading, setIsProcessingLoading] = useState(false)
  const [processingError, setProcessingError] = useState<{
    operation: 'inpaint' | 'upscale'
    details: string
    retry?: () => void
  }>()
  const [generateProgress, setGenerateProgress] = useState(0)
  const [upscaleStatus, setUpscaleStatus] = useState<UpscaleStatus>()
  const processingBusy = useRef(false)
  const modalRef = useRef(null)
  const historyListRef = useRef<HTMLDivElement>(null)
  const scaledBrushSize = brushSize
  const canvasDiv = useRef<HTMLDivElement>(null)
  const [downloaded, setDownloaded] = useState(true)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(0)
  const [inpaintStage, setInpaintStage] = useState<InpaintStage | null>(null)
  const mountedRef = useRef(true)

  const onloading = useCallback(() => {
    setProcessingError(undefined)
    processingBusy.current = true
    setIsProcessingLoading(true)
    setInpaintStage('processing_model')
    return {
      close: () => {
        processingBusy.current = false
        if (mountedRef.current) {
          setInpaintStage(null)
          setIsProcessingLoading(false)
        }
      },
    }
  }, [])

  useLayoutEffect(
    () => () => {
      mountedRef.current = false
      lifetime.abort()
      window.clearTimeout(hideBrushTimeoutRef.current)
    },
    [lifetime]
  )

  const draw = useCallback(
    (index = history.index) => {
      if (!context) {
        return
      }
      context.clearRect(0, 0, context.canvas.width, context.canvas.height)
      const currRender = history.entries[index] ?? original
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
      // Resizing clears the drawing state and reallocates the backing buffer.
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      if (currRender?.src) {
        context.drawImage(currRender, 0, 0, canvas.width, canvas.height)
      } else {
        context.drawImage(original, 0, 0, canvas.width, canvas.height)
      }
      drawStroke(context, currentLineRef.current)
    },
    [context, original, history]
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
    drawStroke(ctx, currentLineRef.current, 'white')
  }, [context, maskCanvas])

  // Toolbars and translated labels can resize the workspace without a window
  // resize. Observe the actual container and batch redraws into one frame.
  useEffect(() => {
    const container = canvasDiv.current
    if (!container || !context || !isOriginalLoaded) return
    draw()
    let frame: number | undefined
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(() => {
        frame = undefined
        draw()
      })
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [context, draw, isOriginalLoaded])

  // Handle mouse interactions
  useEffect(() => {
    const canvas = context?.canvas
    if (!canvas) {
      return
    }
    let activePointerId: number | null = null
    let paintFrame: number | undefined
    const cancelPaintFrame = () => {
      if (paintFrame !== undefined) window.cancelAnimationFrame(paintFrame)
      paintFrame = undefined
    }

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
        x: (ev.clientX - rect.left) / rect.width,
        y: (ev.clientY - rect.top) / rect.height,
      }
    }
    const onPaint = (px: number, py: number) => {
      currentLineRef.current.pts.push({ x: px, y: py })
      if (paintFrame === undefined) {
        paintFrame = window.requestAnimationFrame(() => {
          paintFrame = undefined
          draw()
        })
      }
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
      if (!isOriginalLoaded || showOriginal || processingBusy.current) {
        return
      }
      if (!currentLineRef.current.pts.length) {
        return
      }
      const stroke = currentLineRef.current
      const loading = onloading()
      try {
        refreshCanvasMask()
        const start = Date.now()
        console.log('inpaint_start')
        // each time based on the last result, the first is the original
        const newFile = currentRender ?? file
        const { default: inpaint } = await import('./adapters/inpainting')
        const res = await inpaint(
          newFile,
          maskCanvas.toDataURL(),
          stage => {
            if (mountedRef.current) setInpaintStage(stage)
          },
          lifetime.signal
        )
        if (!res) {
          throw new Error('empty response')
        }
        const newRender = new Image()
        newRender.dataset.id = Date.now().toString()
        await loadImage(newRender, res, lifetime.signal)
        if (!mountedRef.current) return
        currentLineRef.current = createEmptyLine()
        dispatchHistory({ type: 'append', entry: newRender })
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
          setProcessingError({
            operation: 'inpaint',
            details: error instanceof Error ? error.message : String(error),
            retry: () => {
              currentLineRef.current = stroke
              void processStroke()
            },
          })
        }
      } finally {
        loading.close()
      }
    }
    const onPointerStart = (ev: PointerEvent) => {
      if (
        !isOriginalLoaded ||
        processingBusy.current ||
        activePointerId !== null ||
        showOriginal ||
        (ev.pointerType === 'mouse' && ev.button !== 0)
      ) {
        return
      }
      ev.preventDefault()
      activePointerId = ev.pointerId
      canvas.setPointerCapture(ev.pointerId)
      currentLineRef.current.size =
        brushSize / canvas.getBoundingClientRect().width
      const point = getCanvasPoint(ev)
      onPaint(point.x, point.y)
    }
    const onPointerUp = (ev: PointerEvent) => {
      if (activePointerId !== ev.pointerId) {
        return
      }
      activePointerId = null
      cancelPaintFrame()
      const point = getCanvasPoint(ev)
      const lastPoint = currentLineRef.current.pts.at(-1)
      if (lastPoint?.x !== point.x || lastPoint?.y !== point.y) {
        currentLineRef.current.pts.push(point)
      }
      draw()
      if (canvas.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId)
      }
      void processStroke()
    }
    const cancelActiveStroke = () => {
      if (activePointerId === null) return
      const pointerId = activePointerId
      activePointerId = null
      cancelPaintFrame()
      if (canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId)
      }
      currentLineRef.current = createEmptyLine()
      draw()
    }
    const onPointerCancel = (ev: PointerEvent) => {
      if (activePointerId === ev.pointerId) cancelActiveStroke()
    }
    const onWindowBlur = () => {
      window.clearTimeout(hideBrushTimeoutRef.current)
      setShowBrush(false)
      cancelActiveStroke()
    }
    const onVisibilityChange = () => {
      if (document.hidden) onWindowBlur()
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
    canvas.addEventListener('lostpointercapture', onPointerCancel)
    canvas.addEventListener('pointerenter', onPointerEnter)
    canvas.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelPaintFrame()
      if (activePointerId !== null) {
        if (canvas.hasPointerCapture(activePointerId)) {
          canvas.releasePointerCapture(activePointerId)
        }
        currentLineRef.current = createEmptyLine()
      }
      canvas.removeEventListener('pointerdown', onPointerStart)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('lostpointercapture', onPointerCancel)
      canvas.removeEventListener('pointerenter', onPointerEnter)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [
    brushSize,
    context,
    file,
    draw,
    refreshCanvasMask,
    maskCanvas,
    isOriginalLoaded,
    currentRender,
    showOriginal,
    onloading,
    scaledBrushSize,
    lifetime,
  ])

  useEffect(() => {
    if (!history.entries.length) return
    const frame = window.requestAnimationFrame(() => {
      if (!historyListRef.current) return
      const selected = historyListRef.current.children[history.index] as
        HTMLElement | undefined
      historyListRef.current.scrollTo({
        left: selected
          ? selected.offsetLeft -
            historyListRef.current.clientWidth / 2 +
            selected.offsetWidth / 2
          : 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [history.index, history.entries])

  function download() {
    if (processingBusy.current || !isOriginalLoaded) return
    const currRender = currentRender ?? original
    const source = currRender.currentSrc || currRender.src
    downloadImage(
      source,
      imageFileName(
        file.name,
        currentRender ? 'image/png' : file.type,
        !!currentRender
      )
    )
  }

  const undo = useCallback(() => {
    if (processingBusy.current) return
    currentLineRef.current = createEmptyLine()
    dispatchHistory({ type: 'undo' })
  }, [])

  const redo = useCallback(() => {
    if (processingBusy.current) return
    currentLineRef.current = createEmptyLine()
    dispatchHistory({ type: 'redo' })
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target
      if (
        processingBusy.current ||
        event.defaultPrevented ||
        event.altKey ||
        event.isComposing ||
        document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"]'
        ) ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest('input, textarea, select, dialog, [role="dialog"]')))
      ) {
        return
      }
      const key = event.key.toLowerCase()
      const modifier = event.metaKey || event.ctrlKey
      const isUndo = modifier && key === 'z' && !event.shiftKey
      const isRedo =
        (modifier && key === 'z' && event.shiftKey) ||
        (event.ctrlKey && !event.metaKey && key === 'y' && !event.shiftKey)
      if (isUndo && canUndo) {
        event.preventDefault()
        undo()
      } else if (isRedo && canRedo) {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
    }
  }, [canUndo, canRedo, undo, redo])

  const backTo = useCallback((index: number) => {
    if (processingBusy.current) return
    currentLineRef.current = createEmptyLine()
    dispatchHistory({ type: 'select', index })
  }, [])

  const backHereLabel = message('back_here')
  const historyStepLabel = message('history_step')
  const History = useMemo(
    () =>
      history.entries.map((render, index) => {
        return (
          <div
            key={render.dataset.id}
            className={
              index === history.index ? 'rounded-sm ring-2 ring-primary' : ''
            }
            style={{
              position: 'relative',
              display: 'inline-block',
              flexShrink: 0,
            }}
          >
            <img
              src={render.src}
              alt={`${historyStepLabel} ${index + 1}`}
              className="rounded-sm"
              style={{
                height: '90px',
              }}
            />
            <Button
              disabled={isInpaintingLoading}
              ariaLabel={`${backHereLabel} ${index + 1}`}
              ariaPressed={index === history.index}
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
              onEnter={() => {
                if (!processingBusy.current) draw(index)
              }}
              onLeave={() => {
                if (!processingBusy.current) draw()
              }}
            >
              <div
                style={{
                  color: '#fff',
                  fontSize: '12px',
                  textAlign: 'center',
                }}
              >
                {backHereLabel}
              </div>
            </Button>
          </div>
        )
      }),
    [
      history,
      backTo,
      draw,
      isInpaintingLoading,
      backHereLabel,
      historyStepLabel,
    ]
  )

  const handleSliderStart = () => {
    setShowBrush(true)
  }
  const handleSliderChange = (sliderValue: number) => {
    setShowBrush(true)
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
    if (processingBusy.current || !isOriginalLoaded) return
    const source = currentRender ?? original
    const plan = getUpscalePlan(source.naturalWidth, source.naturalHeight)
    if (!plan.ok) return
    processingBusy.current = true
    setProcessingError(undefined)
    setInpaintStage(null)
    setUpscaleStatus({ stage: 'processing_model' })
    setGenerateProgress(0)
    setIsProcessingLoading(true)
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
      const newFile = currentRender ?? file
      const { default: superResolution } =
        await import('./adapters/superResolution')
      const res = await superResolution(
        newFile,
        progress => {
          if (mountedRef.current) setGenerateProgress(progress)
        },
        status => {
          if (mountedRef.current) setUpscaleStatus(status)
        },
        lifetime.signal
      )
      if (!res) {
        throw new Error('empty response')
      }
      const newRender = new Image()
      newRender.dataset.id = Date.now().toString()
      await loadImage(newRender, res, lifetime.signal)
      if (!mountedRef.current) return
      currentLineRef.current = createEmptyLine()
      dispatchHistory({ type: 'append', entry: newRender })
      console.log('superResolution_processed', {
        duration: Date.now() - start,
      })

      // 替换当前图片
    } catch (error) {
      console.error('superResolution', error)
      if (mountedRef.current) {
        setProcessingError({
          operation: 'upscale',
          details: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      processingBusy.current = false
      if (mountedRef.current) {
        setUpscaleStatus(undefined)
        setDownloaded(true)
        setIsProcessingLoading(false)
      }
    }
  }, [file, currentRender, original, isOriginalLoaded, lifetime])

  return (
    <div
      aria-busy={isInpaintingLoading || (!isOriginalLoaded && !imageError)}
      className={[
        'editor-shell theme-surface flex h-full min-h-0 flex-col items-center overflow-hidden bg-canvas px-3 sm:px-6',
        isInpaintingLoading ? 'pointer-events-none' : '',
      ].join(' ')}
    >
      {/* History */}
      {history.entries.length > 0 && (
        <div
          ref={historyListRef}
          className={[
            'theme-surface history-scrollbar relative mt-3 flex h-28 w-full max-w-5xl flex-none flex-row items-center gap-4 overflow-x-auto rounded-2xl border border-line bg-panel p-3 shadow-sm',
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
        {!isOriginalLoaded && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
            {imageError ? (
              <>
                <p role="alert">{message('editor_image_failed')}</p>
                <Button onClick={retryImage}>{message('repair_retry')}</Button>
              </>
            ) : (
              <p role="status">{message('editor_image_loading')}</p>
            )}
          </div>
        )}
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
          {showOriginal && <ImageComparison source={original.src} />}
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
                {inpaintStage ? (
                  <p role="status" className="text-sm text-muted">
                    {message(inpaintStage)}
                  </p>
                ) : (
                  <>
                    <p role="status" className="text-sm text-muted">
                      {upscaleStatus?.stage
                        ? message(upscaleStatus.stage)
                        : `${message('upscale_tile')} ${upscaleStatus?.tile ?? 1} / ${upscaleStatus?.total ?? 1}`}
                    </p>
                    {!upscaleStatus?.stage && (
                      <Progress
                        percent={generateProgress}
                        label={message('upscale')}
                      />
                    )}
                    <p className="text-xs text-muted">
                      {message('upscale_wait')}
                    </p>
                  </>
                )}
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
            <Progress
              percent={downloadProgress}
              label={message('upscaleing_model_download_message')}
            />
          </div>
        </Modal>
      )}
      <div
        hidden={!showBrush}
        aria-hidden="true"
        className="fixed left-0 top-0 rounded-full border border-white/50 bg-red-500/45 shadow-[0_0_0_1px_rgba(0,0,0,0.25)] pointer-events-none"
        style={{
          width: `${scaledBrushSize}px`,
          height: `${scaledBrushSize}px`,
          transform: `translate3d(-100px, -100px, 0)`,
        }}
        ref={brushRef}
      />
      {/* 工具栏 */}
      {isOriginalLoaded && (
        <p
          id="upscale-details"
          className="mb-2 w-full max-w-5xl text-center text-xs leading-5 text-muted"
        >
          {sourceImage.naturalWidth} × {sourceImage.naturalHeight} px
          {' · '}
          {upscalePlan.ok
            ? `${message('upscale_output')}: ${upscalePlan.width} × ${upscalePlan.height} px`
            : message(upscalePlan.reason)}
        </p>
      )}
      <fieldset
        disabled={isInpaintingLoading || !isOriginalLoaded}
        aria-label={message('editor_tools')}
        className={[
          'toolbar-enter theme-surface mb-3 grid min-w-0 w-full max-w-5xl flex-none grid-cols-2 items-center gap-2 rounded-2xl border border-line bg-panel/95 p-3 shadow-xl backdrop-blur-xl',
          'sm:flex sm:flex-row sm:flex-wrap sm:justify-between sm:gap-3',
        ].join(' ')}
      >
        {history.entries.length > 0 && (
          <div className="col-span-2 flex items-center justify-center gap-2">
            <Button
              disabled={!canUndo}
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
            <Button
              disabled={!canRedo}
              className="w-full sm:w-auto"
              onClick={redo}
              icon={<ReplyIcon className="h-6 w-6 -scale-x-100" />}
            >
              {message('redo')}
            </Button>
          </div>
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
          ariaPressed={showOriginal}
          className="w-full sm:w-auto"
          icon={<EyeIcon className="w-6 h-6" />}
          onClick={() => {
            setShowBrush(false)
            setShowOriginal(current => !current)
          }}
        >
          {message('original')}
        </Button>
        {!showOriginal && (
          <Button
            className="w-full sm:w-auto"
            disabled={!upscalePlan.ok}
            ariaDescribedBy="upscale-details"
            onClick={onSuperResolution}
          >
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
      </fieldset>
      {processingError && (
        <Modal
          ariaLabel={message('processing_failed')}
          onClose={() => setProcessingError(undefined)}
        >
          <div className="space-y-4">
            <h2 className="text-xl font-black">
              {message('processing_failed')}
            </h2>
            <p className="text-sm leading-6 text-muted">
              {message(
                processingError.operation === 'inpaint'
                  ? 'inpaint_failed_hint'
                  : 'processing_failed_hint'
              )}
            </p>
            <p role="alert" className="break-words text-sm text-muted">
              {processingError.details}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                primary
                onClick={
                  processingError.operation === 'upscale'
                    ? onSuperResolution
                    : processingError.retry
                }
              >
                {message('repair_retry')}
              </Button>
              <RepairRuntime />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
