import { useRef, useState } from 'react'
import { repairRuntime } from '../adapters/runtime'
import { message } from '../i18n'
import Button from './Button'
import Modal from './Modal'
import Progress from './Progress'

export default function RepairRuntime({
  onRepaired,
}: {
  onRepaired?: () => void
}) {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>(
    'idle'
  )
  const [progress, setProgress] = useState<number | null>(0)
  const [error, setError] = useState('')
  const busy = useRef(false)

  async function repair() {
    if (busy.current) return
    busy.current = true
    setStatus('working')
    setProgress(0)
    try {
      await repairRuntime(setProgress)
      setStatus('done')
      onRepaired?.()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      setStatus('error')
    } finally {
      busy.current = false
    }
  }

  return (
    <>
      <Button
        onClick={() => {
          void repair()
        }}
        disabled={status === 'working'}
      >
        {message('repair_runtime')}
      </Button>
      {status !== 'idle' && (
        <Modal
          ariaLabel={message('repair_runtime')}
          onClose={status === 'working' ? undefined : () => setStatus('idle')}
        >
          <div className="space-y-5" aria-busy={status === 'working'}>
            <h2 className="text-xl font-black">{message('repair_runtime')}</h2>
            <p role="status" className="text-sm leading-6 text-muted">
              {message(
                status === 'working'
                  ? 'repair_working'
                  : status === 'done'
                    ? 'repair_done'
                    : 'repair_failed'
              )}
            </p>
            {status === 'working' && (
              <Progress percent={progress} label={message('repair_runtime')} />
            )}
            {status === 'error' && (
              <p role="alert" className="break-words text-sm text-muted">
                {error}
              </p>
            )}
            {status !== 'working' && (
              <div className="flex gap-2">
                {status === 'error' && (
                  <Button
                    primary
                    onClick={() => {
                      void repair()
                    }}
                  >
                    {message('repair_retry')}
                  </Button>
                )}
                <Button onClick={() => setStatus('idle')}>
                  {message('repair_close')}
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
