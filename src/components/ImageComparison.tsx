import { useState } from 'react'
import { ViewBoardsIcon } from '@heroicons/react/outline'
import { message } from '../i18n'

export default function ImageComparison({ source }: { source: string }) {
  const [position, setPosition] = useState(0)
  return (
    <div className="group absolute inset-0">
      <img
        src={source}
        alt={message('original')}
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full max-w-none rounded-xl"
        style={{ clipPath: `inset(0 0 0 ${position}%)` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary"
        style={{ left: `${position}%` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl bg-primary text-primary-ink shadow-lg group-focus-within:ring-2 group-focus-within:ring-ink group-focus-within:ring-offset-2"
        style={{ left: `clamp(22px, ${position}%, calc(100% - 22px))` }}
      >
        <ViewBoardsIcon className="h-5 w-5" />
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-2 rounded-lg bg-black/60 px-2 py-1 text-xs font-bold text-white"
      >
        {message('original')}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={position}
        aria-label={message('comparison_position')}
        aria-valuetext={`${message('original_visible')}: ${100 - position}%`}
        aria-describedby="comparison-help"
        onChange={event => setPosition(Number(event.currentTarget.value))}
        className="comparison-range absolute inset-0 m-0 h-full w-full cursor-ew-resize touch-none opacity-0"
      />
      <p id="comparison-help" className="sr-only">
        {message('comparison_help')}
      </p>
    </div>
  )
}
