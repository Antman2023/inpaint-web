import { PhotographIcon } from '@heroicons/react/outline'
import { useRef, useState } from 'react'
import { message } from '../i18n'
import { IMAGE_TYPES } from '../imageImport'

type FileSelectProps = {
  onSelection: (file: File) => void
  busy?: boolean
}

export default function FileSelect(props: FileSelectProps) {
  const { onSelection, busy = false } = props

  const [dragHover, setDragHover] = useState(false)
  const dragDepth = useRef(0)
  const [dropError, setDropError] = useState(false)
  const [uploadElemId] = useState(`file-upload-${Math.random().toString()}`)

  function handleDrop(ev: React.DragEvent) {
    if (!ev.dataTransfer.types.includes('Files')) return
    ev.preventDefault()
    ev.stopPropagation()
    dragDepth.current = 0
    setDragHover(false)
    // This editor accepts one image at a time.
    const files = Array.from(ev.dataTransfer.files)
    const file = files.find(file => IMAGE_TYPES.includes(file.type)) ?? files[0]
    setDropError(!file)
    if (file) onSelection(file)
  }

  return (
    <label
      htmlFor={uploadElemId}
      aria-busy={busy}
      className="group relative block h-full w-full cursor-pointer rounded-3xl font-medium focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-primary"
    >
      <div
        className={[
          'upload-zone theme-surface flex h-full w-full items-center justify-center rounded-3xl border border-dashed px-6 py-8 text-center',
          'border-line bg-panel hover:border-primary hover:bg-hover',
          dragHover
            ? 'motion-safe:scale-[1.01] border-primary bg-hover shadow-[0_0_0_4px_rgba(189,255,1,0.12)]'
            : '',
        ].join(' ')}
        onDrop={handleDrop}
        onDragEnter={ev => {
          if (!ev.dataTransfer.types.includes('Files')) return
          ev.preventDefault()
          dragDepth.current++
          setDragHover(true)
        }}
        onDragOver={ev => {
          if (!ev.dataTransfer.types.includes('Files')) return
          ev.stopPropagation()
          ev.preventDefault()
          ev.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragHover(false)
        }}
      >
        <input
          id={uploadElemId}
          name={uploadElemId}
          type="file"
          className="sr-only"
          onChange={ev => {
            const file = ev.currentTarget.files?.[0]
            ev.currentTarget.value = ''
            if (file) {
              setDropError(false)
              onSelection(file)
            }
          }}
          accept={IMAGE_TYPES.join(',')}
        />
        <div className="flex flex-col items-center">
          <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-ink shadow-[0_12px_32px_rgba(189,255,1,0.18)] motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:-translate-y-1">
            <PhotographIcon className="h-7 w-7" />
          </span>
          <p className="text-lg font-bold tracking-tight sm:text-xl">
            {message('drop_zone')}
          </p>
          <p className="mt-2 text-sm font-normal text-muted">
            {message('supported_files')}
          </p>
          {dropError && (
            <p role="alert" className="mt-2 text-sm text-muted">
              {message('invalid_file')}
            </p>
          )}
        </div>
      </div>
    </label>
  )
}
