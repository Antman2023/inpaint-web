import { message } from '../i18n'

interface ProgressProps {
  percent: number | null
  label: string
}

export default function Progress({ percent, label }: ProgressProps) {
  const safePercent =
    percent !== null && Number.isFinite(percent)
      ? Math.min(100, Math.max(0, percent))
      : undefined

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safePercent}
      aria-valuetext={
        safePercent === undefined ? message('progress_unknown') : undefined
      }
      className="flex w-full items-center gap-4"
    >
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-panel-strong">
        <div
          className={`absolute left-0 top-0 h-full rounded-full bg-primary duration-100 ${safePercent === undefined ? 'motion-safe:animate-pulse' : ''}`}
          style={{
            width: safePercent === undefined ? '40%' : `${safePercent}%`,
          }}
        />
      </div>
      <span className="min-w-16 text-right text-sm tabular-nums text-muted">
        {safePercent === undefined
          ? message('progress_unknown')
          : `${safePercent.toFixed(1)}%`}
      </span>
    </div>
  )
}
