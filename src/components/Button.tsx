import { type CSSProperties, type ReactNode, useState } from 'react'

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
  const [active, setActive] = useState(false)
  let appearance = 'bg-transparent text-ink hover:bg-hover'
  if (primary) {
    appearance =
      'bg-primary text-primary-ink hover:bg-primary-strong shadow-[0_8px_24px_rgba(189,255,1,0.16)]'
  }
  if (active && !disabled) {
    appearance = 'bg-ink text-canvas'
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-pressed={ariaPressed}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={() => {
        if (disabled) return
        setActive(true)
      }}
      onPointerUp={() => {
        setActive(false)
      }}
      onPointerEnter={() => {
        onEnter?.()
      }}
      onPointerLeave={() => {
        setActive(false)
        onLeave?.()
      }}
      className={[
        'theme-control inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold sm:px-4',
        'disabled:pointer-events-none disabled:opacity-35',
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
