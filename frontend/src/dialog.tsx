import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type AlertOptions = {
  title?: string
  message: string
  confirmLabel?: string
}

type ConfirmOptions = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type PromptOptions = {
  title: string
  message?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  placeholder?: string
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

type UnsavedOptions = {
  title?: string
  message: string
  saveLabel?: string
  discardLabel?: string
  cancelLabel?: string
}

type DialogApi = {
  alert: (opts: AlertOptions | string) => Promise<void>
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>
  prompt: (opts: PromptOptions) => Promise<string | null>
  /** Save / Don't save / Cancel for closing dirty tabs. */
  unsaved: (opts: UnsavedOptions) => Promise<UnsavedChoice>
}

type ActiveDialog =
  | {
      kind: 'alert'
      title: string
      message: string
      confirmLabel: string
      resolve: () => void
    }
  | {
      kind: 'confirm'
      title: string
      message: string
      confirmLabel: string
      cancelLabel: string
      danger: boolean
      resolve: (ok: boolean) => void
    }
  | {
      kind: 'prompt'
      title: string
      message?: string
      defaultValue: string
      confirmLabel: string
      cancelLabel: string
      placeholder?: string
      resolve: (value: string | null) => void
    }
  | {
      kind: 'unsaved'
      title: string
      message: string
      saveLabel: string
      discardLabel: string
      cancelLabel: string
      resolve: (choice: UnsavedChoice) => void
    }

const DialogContext = createContext<DialogApi | null>(null)

function normalizeAlert(opts: AlertOptions | string): AlertOptions {
  return typeof opts === 'string' ? { message: opts } : opts
}

function normalizeConfirm(opts: ConfirmOptions | string): ConfirmOptions {
  return typeof opts === 'string' ? { message: opts } : opts
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveDialog | null>(null)

  const api: DialogApi = {
    alert: (opts) =>
      new Promise((resolve) => {
        const o = normalizeAlert(opts)
        setActive({
          kind: 'alert',
          title: o.title ?? 'Notice',
          message: o.message,
          confirmLabel: o.confirmLabel ?? 'OK',
          resolve,
        })
      }),
    confirm: (opts) =>
      new Promise((resolve) => {
        const o = normalizeConfirm(opts)
        setActive({
          kind: 'confirm',
          title: o.title ?? 'Confirm',
          message: o.message,
          confirmLabel: o.confirmLabel ?? 'OK',
          cancelLabel: o.cancelLabel ?? 'Cancel',
          danger: o.danger ?? false,
          resolve,
        })
      }),
    prompt: (opts) =>
      new Promise((resolve) => {
        setActive({
          kind: 'prompt',
          title: opts.title,
          message: opts.message,
          defaultValue: opts.defaultValue ?? '',
          confirmLabel: opts.confirmLabel ?? 'OK',
          cancelLabel: opts.cancelLabel ?? 'Cancel',
          placeholder: opts.placeholder,
          resolve,
        })
      }),
    unsaved: (opts) =>
      new Promise((resolve) => {
        setActive({
          kind: 'unsaved',
          title: opts.title ?? 'Unsaved changes',
          message: opts.message,
          saveLabel: opts.saveLabel ?? 'Save',
          discardLabel: opts.discardLabel ?? "Don't save",
          cancelLabel: opts.cancelLabel ?? 'Cancel',
          resolve,
        })
      }),
  }

  const close = () => setActive(null)

  return (
    <DialogContext.Provider value={api}>
      {children}
      {active
        ? createPortal(
            <DialogModal
              dialog={active}
              onDismiss={() => {
                if (active.kind === 'alert') {
                  active.resolve()
                } else if (active.kind === 'confirm') {
                  active.resolve(false)
                } else if (active.kind === 'unsaved') {
                  active.resolve('cancel')
                } else {
                  active.resolve(null)
                }
                close()
              }}
              onConfirm={(value) => {
                if (active.kind === 'alert') {
                  active.resolve()
                } else if (active.kind === 'confirm') {
                  active.resolve(true)
                } else if (active.kind === 'unsaved') {
                  active.resolve('save')
                } else {
                  active.resolve(value ?? '')
                }
                close()
              }}
              onDiscard={() => {
                if (active.kind === 'unsaved') {
                  active.resolve('discard')
                  close()
                }
              }}
            />,
            document.body,
          )
        : null}
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog requires DialogProvider')
  return ctx
}

function DialogModal({
  dialog,
  onDismiss,
  onConfirm,
  onDiscard,
}: {
  dialog: ActiveDialog
  onDismiss: () => void
  onConfirm: (value?: string) => void
  onDiscard: () => void
}) {
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(
    dialog.kind === 'prompt' ? dialog.defaultValue : '',
  )

  useEffect(() => {
    if (dialog.kind === 'prompt') {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.select()
      return
    }
    const btn = document.querySelector<HTMLButtonElement>(
      '.dialog-modal [data-dialog-primary]',
    )
    btn?.focus()
  }, [dialog])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  const submitPrompt = () => onConfirm(value)

  return (
    <div
      className="modal-backdrop dialog-backdrop"
      onClick={onDismiss}
      role="presentation"
    >
      <div
        className="modal dialog-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header" id={titleId}>
          {dialog.title}
        </div>

        {dialog.message ? (
          <div className="dialog-message">{dialog.message}</div>
        ) : null}

        {dialog.kind === 'prompt' ? (
          <form
            className="dialog-form"
            onSubmit={(e) => {
              e.preventDefault()
              submitPrompt()
            }}
          >
            <input
              ref={inputRef}
              className="input dialog-input"
              value={value}
              placeholder={dialog.placeholder}
              onChange={(e) => setValue(e.target.value)}
              aria-label={dialog.title}
            />
          </form>
        ) : null}

        <div className="dialog-actions">
          {dialog.kind === 'unsaved' ? (
            <>
              <button type="button" className="btn" onClick={onDismiss}>
                {dialog.cancelLabel}
              </button>
              <button
                type="button"
                className="btn dialog-btn-danger"
                onClick={onDiscard}
              >
                {dialog.discardLabel}
              </button>
              <button
                type="button"
                className="btn-primary"
                data-dialog-primary
                onClick={() => onConfirm()}
              >
                {dialog.saveLabel}
              </button>
            </>
          ) : (
            <>
              {dialog.kind !== 'alert' ? (
                <button type="button" className="btn" onClick={onDismiss}>
                  {dialog.cancelLabel}
                </button>
              ) : null}
              <button
                type="button"
                className={
                  dialog.kind === 'confirm' && dialog.danger
                    ? 'btn dialog-btn-danger'
                    : 'btn-primary'
                }
                data-dialog-primary
                onClick={() => {
                  if (dialog.kind === 'prompt') submitPrompt()
                  else onConfirm()
                }}
              >
                {dialog.confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
