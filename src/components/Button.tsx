import type { CSSProperties, ReactNode } from 'react'

interface ButtonProps {
  children: ReactNode
  className?: string
  icon?: ReactNode
  primary?: boolean
  style?: CSSProperties
  ariaLabel?: string
  ariaDescribedBy?: string
  ariaPressed?: boolean
  disabled?: boolean
  onClick?: () => void
  onEnter?: () => void
  onLeave?: () => void
}

export default function Button(props: ButtonProps) {
  const {
    children,
    className,
    icon,
    primary,
    style,
    onClick,
    onEnter,
    onLeave,
    ariaLabel,
    ariaDescribedBy,
    ariaPressed,
    disabled,
  } = props
  let appearance = 'bg-transparent text-ink hover:bg-hover'
  if (primary) {
    appearance =
      'bg-primary text-primary-ink hover:bg-primary-strong shadow-[0_8px_24px_rgba(189,255,1,0.16)]'
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-pressed={ariaPressed}
      disabled={disabled}
      onClick={onClick}
      onPointerEnter={() => {
        onEnter?.()
      }}
      onPointerLeave={() => {
        onLeave?.()
      }}
      className={[
        'theme-control inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold sm:px-4',
        'disabled:pointer-events-none disabled:opacity-35',
        'enabled:active:bg-ink enabled:active:text-canvas',
        appearance,
        className,
      ].join(' ')}
      style={style}
    >
      {icon}
      <span className="whitespace-nowrap select-none">{children}</span>
    </button>
  )
}
