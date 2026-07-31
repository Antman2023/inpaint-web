import type { ReactNode } from 'react'

interface ModalProps {
  children?: ReactNode
}

export default function Modal(props: ModalProps) {
  const { children } = props
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm">
      <div className="theme-surface max-h-[80svh] w-full max-w-2xl overflow-auto rounded-3xl border border-line bg-panel p-6 text-ink shadow-2xl sm:p-10">
        {children}
      </div>
    </div>
  )
}
