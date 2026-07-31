/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import { DownloadIcon, EyeIcon, ViewBoardsIcon } from '@heroicons/react/outline'
import { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import inpaint from './adapters/inpainting'
import superResolution from './adapters/superResolution'
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

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: Line[],
  color = 'rgba(255, 0, 0, 0.5)'
) {
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  lines.forEach(line => {
    if (!line?.pts.length || !line.size) {
      return
    }
    ctx.lineWidth = line.size
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
  const [lines, setLines] = useState<Line[]>([{ pts: [], src: '' }])
  const brushRef = useRef<HTMLDivElement>(null)
  const [showBrush, setShowBrush] = useState(false)
  const [hideBrushTimeout, setHideBrushTimeout] = useState(0)
  const [showOriginal, setShowOriginal] = useState(false)
  const [isInpaintingLoading, setIsProcessingLoading] = useState(false)
  const [generateProgress, setGenerateProgress] = useState(0)
  const modalRef = useRef(null)
  const [separator, setSeparator] = useState<HTMLDivElement>()
  const [useSeparator, setUseSeparator] = useState(false)
  const [originalImg, setOriginalImg] = useState<HTMLDivElement>()
  const [separatorLeft, setSeparatorLeft] = useState(0)
  const historyListRef = useRef<HTMLDivElement>(null)
  const isBrushSizeChange = useRef<boolean>(false)
  const scaledBrushSize = useMemo(() => brushSize, [brushSize])
  const canvasDiv = useRef<HTMLDivElement>(null)
  const [downloaded, setDownloaded] = useState(true)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const windowSize = useWindowSize()

  const onloading = useCallback(() => {
    setIsProcessingLoading(true)
    setGenerateProgress(0)
    const progressTimer = window.setInterval(() => {
      setGenerateProgress(p => {
        if (p < 90) return p + 10 * Math.random()
        if (p >= 90 && p < 99) return p + 1 * Math.random()
        // Do not hide the progress bar after 99%,cause sometimes long time progress
        // window.setTimeout(() => setIsInpaintingLoading(false), 500)
        return p
      })
    }, 1000)
    return {
      close: () => {
        clearInterval(progressTimer)
        setGenerateProgress(100)
        setIsProcessingLoading(false)
      },
    }
  }, [])

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

      canvas.width = canvasWidth
      canvas.height = canvasHeight

      if (currRender?.src) {
        context.drawImage(currRender, 0, 0, canvas.width, canvas.height)
      } else {
        context.drawImage(original, 0, 0, canvas.width, canvas.height)
      }
      const currentLine = lines[lines.length - 1]
      drawLines(context, [currentLine])
    },
    [context, lines, original, renders]
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
    // Just need the finishing touch
    const line = lines.slice(-1)[0]
    if (line) drawLines(ctx, [line], 'white')
  }, [context?.canvas.height, context?.canvas.width, lines, maskCanvas])

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
    const onMouseMove = (ev: MouseEvent) => {
      if (brushRef.current) {
        const x = ev.pageX - scaledBrushSize / 2
        const y = ev.pageY - scaledBrushSize / 2

        brushRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`
      }
    }
    const onPaint = (px: number, py: number) => {
      const currLine = lines[lines.length - 1]
      currLine.pts.push({ x: px, y: py })
      draw()
    }
    const onMouseDrag = (ev: MouseEvent) => {
      const px = ev.offsetX - canvas.offsetLeft
      const py = ev.offsetY - canvas.offsetTop
      onPaint(px, py)
    }

    const onPointerUp = async () => {
      if (!original.src || showOriginal) {
        return
      }
      if (lines.slice(-1)[0]?.pts.length === 0) {
        return
      }
      const loading = onloading()
      canvas.removeEventListener('mousemove', onMouseDrag)
      canvas.removeEventListener('mouseup', onPointerUp)
      refreshCanvasMask()
      try {
        const start = Date.now()
        console.log('inpaint_start')
        // each time based on the last result, the first is the original
        const newFile = renders.slice(-1)[0] ?? file
        const res = await inpaint(newFile, maskCanvas.toDataURL())
        if (!res) {
          throw new Error('empty response')
        }
        // TODO: fix the render if it failed loading
        const newRender = new Image()
        newRender.dataset.id = Date.now().toString()
        await loadImage(newRender, res)
        renders.push(newRender)
        lines.push({ pts: [], src: '' } as Line)
        setRenders([...renders])
        setLines([...lines])
        console.log('inpaint_processed', {
          duration: Date.now() - start,
        })
      } catch (error) {
        console.log('inpaint_failed', {
          error,
        })
        alert(error instanceof Error ? error.message : String(error))
      }
      if (historyListRef.current) {
        const { scrollWidth, clientWidth } = historyListRef.current
        if (scrollWidth > clientWidth) {
          historyListRef.current.scrollTo(scrollWidth, 0)
        }
      }
      loading.close()
      draw()
    }
    canvas.addEventListener('mousemove', onMouseMove)

    const onTouchMove = (ev: TouchEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      const currLine = lines[lines.length - 1]
      const coords = canvas.getBoundingClientRect()
      currLine.pts.push({
        x: ev.touches[0].clientX - coords.x,
        y: ev.touches[0].clientY - coords.y,
      })
      draw()
    }
    const onPointerStart = () => {
      if (!original.src || showOriginal) {
        return
      }
      const currLine = lines[lines.length - 1]
      currLine.size = brushSize
      canvas.addEventListener('mousemove', onMouseDrag)
      canvas.addEventListener('mouseup', onPointerUp)
      // onPaint(e)
    }

    canvas.addEventListener('touchstart', onPointerStart)
    canvas.addEventListener('touchmove', onTouchMove)
    canvas.addEventListener('touchend', onPointerUp)
    canvas.onmouseenter = () => {
      window.clearTimeout(hideBrushTimeout)
      setShowBrush(true && !showOriginal)
    }
    canvas.onmouseleave = () => setShowBrush(false)
    canvas.onmousedown = onPointerStart

    return () => {
      canvas.removeEventListener('mousemove', onMouseDrag)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup', onPointerUp)
      canvas.removeEventListener('touchstart', onPointerStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onPointerUp)
      canvas.onmouseenter = null
      canvas.onmouseleave = null
      canvas.onmousedown = null
    }
  }, [
    brushSize,
    context,
    file,
    draw,
    lines,
    refreshCanvasMask,
    maskCanvas,
    original.src,
    renders,
    showOriginal,
    hideBrushTimeout,
    onloading,
    scaledBrushSize,
  ])

  useEffect(() => {
    if (!separator || !originalImg) return

    const separatorMove = (ev: MouseEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      if (context?.canvas) {
        const { width } = context.canvas
        const canvasRect = context.canvas.getBoundingClientRect()
        const separatorOffsetLeft = ev.pageX - canvasRect.left
        if (separatorOffsetLeft <= width && separatorOffsetLeft >= 0) {
          setSeparatorLeft(separatorOffsetLeft)
        } else if (separatorOffsetLeft < 0) {
          setSeparatorLeft(0)
        } else if (separatorOffsetLeft > width) {
          setSeparatorLeft(width)
        }
      }
    }

    const separatorDown = () => {
      window.addEventListener('mousemove', separatorMove)
      setUseSeparator(true)
    }

    const separatorUp = () => {
      window.removeEventListener('mousemove', separatorMove)
      setUseSeparator(false)
    }

    separator.addEventListener('mousedown', separatorDown)
    window.addEventListener('mouseup', separatorUp)

    return () => {
      separator.removeEventListener('mousedown', separatorDown)
      window.removeEventListener('mouseup', separatorUp)
    }
  }, [separator, context, originalImg])

  function download() {
    const currRender = renders.at(-1) ?? original
    downloadImage(currRender.currentSrc, 'IMG')
  }

  const undo = useCallback(async () => {
    const l = lines
    l.pop()
    l.pop()
    setLines([...l, { pts: [], src: '' }])
    const r = renders
    r.pop()
    setRenders([...r])
  }, [lines, renders])

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

  const backTo = useCallback(
    (index: number) => {
      lines.splice(index + 1)
      setLines([...lines, { pts: [], src: '' }])
      renders.splice(index + 1)
      setRenders([...renders])
    },
    [renders, lines]
  )

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
              className="hover:opacity-100 opacity-0 cursor-pointer rounded-sm"
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
                回到这
                <br />
                Back here
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
    if (!isBrushSizeChange.current) {
      isBrushSizeChange.current = true
    }
    if (brushRef.current) {
      const x = document.documentElement.clientWidth / 2 - scaledBrushSize / 2
      const y = document.documentElement.clientHeight / 2 - scaledBrushSize / 2

      brushRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }
    setBrushSize(sliderValue)
    window.clearTimeout(hideBrushTimeout)
    setHideBrushTimeout(
      window.setTimeout(() => {
        setShowBrush(false)
      }, BRUSH_HIDE_ON_SLIDER_CHANGE_TIMEOUT)
    )
  }

  const onSuperResolution = useCallback(async () => {
    if (!(await modelExists('superResolution'))) {
      setDownloaded(false)
      await downloadModel('superResolution', setDownloadProgress)
      setDownloaded(true)
    }
    setIsProcessingLoading(true)
    try {
      // 运行
      const start = Date.now()
      console.log('superResolution_start')
      // each time based on the last result, the first is the original
      const newFile = renders.at(-1) ?? file
      const res = await superResolution(newFile, setGenerateProgress)
      if (!res) {
        throw new Error('empty response')
      }
      // TODO: fix the render if it failed loading
      const newRender = new Image()
      newRender.dataset.id = Date.now().toString()
      await loadImage(newRender, res)
      renders.push(newRender)
      lines.push({ pts: [], src: '' } as Line)
      setRenders([...renders])
      setLines([...lines])
      console.log('superResolution_processed', {
        duration: Date.now() - start,
      })

      // 替换当前图片
    } catch (error) {
      console.error('superResolution', error)
    } finally {
      setIsProcessingLoading(false)
    }
  }, [file, lines, renders])

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
            className="rounded-xl shadow-2xl shadow-black/20"
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
              width: showOriginal ? `${context?.canvas.width}px` : '0px',
              height: context?.canvas.height,
              transitionProperty: 'width, height',
              transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
              transitionDuration: '300ms',
            }}
            ref={r => {
              if (r && !originalImg) {
                setOriginalImg(r)
              }
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
                height: context?.canvas.height,
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
                ref={r => {
                  if (r && !separator) {
                    setSeparator(r)
                  }
                }}
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
              width={`${context?.canvas.width}px`}
              height={`${context?.canvas.height}px`}
              style={{
                width: `${context?.canvas.width}px`,
                height: `${context?.canvas.height}px`,
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
                <p className="text-lg font-black">正在处理中，请耐心等待</p>
                <p className="text-sm text-muted">
                  Processing in your browser. This may take a moment.
                </p>
                <Progress percent={generateProgress} />
              </div>
            </div>
          )}
        </div>
      </div>

      {!downloaded && (
        <Modal>
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
          onUp={() => {
            setShowOriginal(!showOriginal)
            setTimeout(() => setSeparatorLeft(0), 300)
          }}
        >
          {message('original')}
        </Button>
        {!showOriginal && (
          <Button className="w-full sm:w-auto" onUp={onSuperResolution}>
            {message('upscale')}
          </Button>
        )}

        <Button
          primary
          className="w-full sm:w-auto"
          icon={<DownloadIcon className="w-6 h-6" />}
          onClick={download}
        >
          {message('download')}
        </Button>
      </div>
    </div>
  )
}
