import type { ReactNode } from 'react'

type SliderProps = {
  label?: ReactNode
  value?: number
  min?: number
  max?: number
  onChange: (value: number) => void
  onStart?: () => void
}

export default function Slider(props: SliderProps) {
  const { value, label, min, max, onChange, onStart } = props

  const step = ((max || 100) - (min || 0)) / 100

  return (
    <label className="inline-flex min-w-[180px] items-center gap-3 text-sm font-medium text-ink">
      <span className="whitespace-nowrap text-muted">{label}</span>
      <input
        aria-label={typeof label === 'string' ? label : undefined}
        className="theme-slider h-2 min-w-24 flex-1 cursor-pointer appearance-none rounded-full bg-panel-strong"
        type="range"
        step={step}
        min={min}
        max={max}
        value={value}
        onPointerDown={onStart}
        onChange={ev => {
          ev.preventDefault()
          ev.stopPropagation()
          onChange(parseInt(ev.currentTarget.value, 10))
        }}
      />
    </label>
  )
}
