interface ProgressProps {
  percent: number
}

export default function Progress({ percent }: ProgressProps) {
  return (
    <div className="flex w-full items-center gap-4">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-panel-strong">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-primary duration-100"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-16 text-right text-sm tabular-nums text-muted">
        {percent.toFixed(1)}%
      </span>
    </div>
  )
}
