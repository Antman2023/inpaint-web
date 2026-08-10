import { PhotographIcon } from '@heroicons/react/outline'
import { useState } from 'react'
import { message } from '../i18n'

type FileSelectProps = {
  onSelection: (file: File) => void | Promise<void>
}

export default function FileSelect(props: FileSelectProps) {
  const { onSelection } = props

  const [dragHover, setDragHover] = useState(false)
  const [uploadElemId] = useState(`file-upload-${Math.random().toString()}`)

  async function onFileSelected(file?: File) {
    if (!file) {
      return
    }
    // Skip non-image files
    const isImage = file.type.match('image.*')
    if (!isImage) {
      return
    }
    try {
      // Check if file is larger than 10mb
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('file too large')
      }
      await onSelection(file)
    } catch (error) {
      alert(`error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function getFile(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => {
      entry.file((file: File) => resolve(file), reject)
    })
  }

  /* eslint-disable no-await-in-loop */

  // Drop handler function to get all files
  async function getAllFileEntries(items: DataTransferItemList) {
    const fileEntries: Array<File> = []
    // Use BFS to traverse entire directory/file structure
    const queue: FileSystemEntry[] = []
    // Unfortunately items is not iterable i.e. no forEach
    for (let i = 0; i < items.length; i += 1) {
      const entry = items[i].webkitGetAsEntry()
      if (entry) {
        queue.push(entry)
      }
    }
    while (queue.length > 0) {
      const entry = queue.shift()
      if (entry?.isFile) {
        // Only append images
        const file = await getFile(entry as FileSystemFileEntry)
        fileEntries.push(file)
      } else if (entry?.isDirectory) {
        queue.push(
          ...(await readAllDirectoryEntries(
            (entry as FileSystemDirectoryEntry).createReader()
          ))
        )
      }
    }
    return fileEntries
  }

  // Get all the entries (files or sub-directories) in a directory
  // by calling readEntries until it returns empty array
  async function readAllDirectoryEntries(
    directoryReader: FileSystemDirectoryReader
  ) {
    const entries: FileSystemEntry[] = []
    let readEntries = await readEntriesPromise(directoryReader)
    while (readEntries.length > 0) {
      entries.push(...readEntries)
      readEntries = await readEntriesPromise(directoryReader)
    }
    return entries
  }

  /* eslint-enable no-await-in-loop */

  // Wrap readEntries in a promise to make working with readEntries easier
  // readEntries will return only some of the entries in a directory
  // e.g. Chrome returns at most 100 entries at a time
  async function readEntriesPromise(
    directoryReader: FileSystemDirectoryReader
  ): Promise<FileSystemEntry[]> {
    return new Promise((resolve, reject) => {
      directoryReader.readEntries(resolve, reject)
    })
  }

  async function handleDrop(ev: React.DragEvent) {
    ev.preventDefault()
    try {
      const items = await getAllFileEntries(ev.dataTransfer.items)
      await onFileSelected(items[0] ?? ev.dataTransfer.files[0])
    } catch (error) {
      alert(`error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setDragHover(false)
    }
  }

  return (
    <label
      htmlFor={uploadElemId}
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
          className="sr-only"
          onChange={ev => {
            const file = ev.currentTarget.files?.[0]
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
