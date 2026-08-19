interface ProgressProps {
  percent: number
}

export default function Progress({ percent }: ProgressProps) {
  const safePercent = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0

  return (
    <div className="flex w-full items-center gap-4">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-panel-strong">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-primary duration-100"
          style={{ width: `${safePercent}%` }}
        />
      </div>
      <span className="w-16 text-right text-sm tabular-nums text-muted">
        {safePercent.toFixed(1)}%
      </span>
    </div>
  )
}
