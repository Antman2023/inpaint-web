import { PhotographIcon } from '@heroicons/react/outline'
import { useRef, useState } from 'react'
import { message } from '../i18n'

type FileSelectProps = {
  onSelection: (file: File) => void | Promise<void>
}

export default function FileSelect(props: FileSelectProps) {
  const { onSelection } = props

  const selectingRef = useRef(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [dragHover, setDragHover] = useState(false)
  const [uploadElemId] = useState(`file-upload-${Math.random().toString()}`)

  async function onFileSelected(file?: File) {
    if (!file || selectingRef.current) {
      return
    }
    selectingRef.current = true
    setIsSelecting(true)
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw new Error(message('invalid_file'))
      }
      if (file.size > 10 * 1024 * 1024) {
        throw new Error(message('file_too_large'))
      }
      await onSelection(file)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      selectingRef.current = false
      setIsSelecting(false)
    }
  }

  async function handleDrop(ev: React.DragEvent) {
    ev.preventDefault()
    setDragHover(false)
    // Snapshot files before awaiting; this editor accepts one image at a time.
    const files = Array.from(ev.dataTransfer.files)
    const file =
      files.find(file =>
        ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
      ) ?? files[0]
    await onFileSelected(file)
  }

  return (
    <label
      htmlFor={uploadElemId}
      aria-busy={isSelecting}
      className="group relative block h-full w-full cursor-pointer font-medium focus-within:outline-none"
    >
      <div
        className={[
          'upload-zone theme-surface flex h-full w-full items-center justify-center rounded-3xl border border-dashed px-6 py-8 text-center',
          'border-line bg-panel hover:border-primary hover:bg-hover',
          dragHover
            ? 'scale-[1.01] border-primary bg-hover shadow-[0_0_0_4px_rgba(189,255,1,0.12)]'
            : '',
        ].join(' ')}
        onDrop={handleDrop}
        onDragOver={ev => {
          ev.stopPropagation()
          ev.preventDefault()
          setDragHover(true)
        }}
        onDragLeave={() => setDragHover(false)}
      >
        <input
          id={uploadElemId}
          name={uploadElemId}
          type="file"
          disabled={isSelecting}
          className="sr-only"
          onChange={ev => {
            const file = ev.currentTarget.files?.[0]
            ev.currentTarget.value = ''
            if (file) {
              void onFileSelected(file)
            }
          }}
          accept="image/png, image/jpeg, image/webp"
        />
        <div className="flex flex-col items-center">
          <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-ink shadow-[0_12px_32px_rgba(189,255,1,0.18)] transition-transform duration-200 group-hover:-translate-y-1">
            <PhotographIcon className="h-7 w-7" />
          </span>
          <p className="text-lg font-bold tracking-tight sm:text-xl">
            {message('drop_zone')}
          </p>
          <p className="mt-2 text-sm font-normal text-muted">
            {message('supported_files')}
          </p>
        </div>
      </div>
    </label>
  )
}
