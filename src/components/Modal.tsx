import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from '@heroicons/react/outline'
import { message } from '../i18n'

interface ModalProps {
  children?: ReactNode
  ariaLabel: string
  onClose?: () => void
}

function focusableElements(dialog: HTMLDialogElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]'
    )
  ).filter(
    element =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden'
  )
}

export default function Modal(props: ModalProps) {
  const { children, ariaLabel, onClose } = props
  const dialogRef = useRef<HTMLDialogElement>(null)
  const backdropPointerDown = useRef(false)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const opener = document.activeElement
    dialog.showModal()
    const initialFocus = focusableElements(dialog)[0] ?? dialog
    initialFocus.focus({ preventScroll: true })
    return () => {
      dialog.close()
      // Parent and child dialogs can unmount together. Restore after both close.
      queueMicrotask(() => {
        if (
          opener instanceof HTMLElement &&
          opener.isConnected &&
          !opener.matches(':disabled') &&
          !opener.closest('dialog:not([open])')
        ) {
          opener.focus({ preventScroll: true })
        }
      })
    }
  }, [])

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={event => {
        if (
          event.key !== 'Tab' ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey
        )
          return
        event.stopPropagation()
        const dialog = event.currentTarget
        const elements = focusableElements(dialog)
        const first = elements[0]
        const last = elements.at(-1)
        if (!first) {
          event.preventDefault()
          dialog.focus()
        } else if (
          !elements.includes(document.activeElement as HTMLElement) ||
          (event.shiftKey
            ? document.activeElement === first
            : document.activeElement === last)
        ) {
          event.preventDefault()
          const nextFocus = event.shiftKey ? last : first
          nextFocus?.focus()
        }
      }}
      onCancel={event => {
        event.preventDefault()
        event.stopPropagation()
        onClose?.()
      }}
      onPointerDown={event => {
        backdropPointerDown.current = event.target === event.currentTarget
      }}
      onPointerCancel={() => {
        backdropPointerDown.current = false
      }}
      onClick={event => {
        if (
          event.target === event.currentTarget &&
          backdropPointerDown.current
        ) {
          onClose?.()
        }
        backdropPointerDown.current = false
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-4 open:flex open:items-center open:justify-center backdrop:bg-overlay backdrop:backdrop-blur-sm"
    >
      <div className="theme-surface relative max-h-[80svh] w-full max-w-2xl overflow-auto rounded-3xl border border-line bg-panel p-6 text-ink shadow-2xl sm:p-10">
        {onClose && (
          <button
            type="button"
            aria-label={message('close')}
            onClick={onClose}
            className="theme-control absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink"
          >
            <XIcon className="h-5 w-5" />
          </button>
        )}
        <div className={onClose ? 'pt-6' : undefined}>{children}</div>
      </div>
    </dialog>,
    document.body
  )
}
