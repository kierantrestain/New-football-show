import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({ title, onClose, children, kind }: { title: string; onClose: () => void; children: ReactNode; kind?: 'match' }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const label = useId()
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return (
    <dialog ref={dialog} className={kind === 'match' ? 'dialog dialog-match' : 'dialog'} aria-labelledby={label} onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="dialog-header">
        <h2 id={label}>{title}</h2>
        <button className="icon-button" type="button" title="Close dialog" aria-label="Close dialog" onClick={onClose}><X size={19} /></button>
      </div>
      {children}
    </dialog>
  )
}
