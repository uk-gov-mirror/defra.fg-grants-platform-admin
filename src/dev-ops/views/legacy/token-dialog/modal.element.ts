import { holdPageGutter } from '../page-gutter.ts'

const fieldSelector = [
  'input:not([type=hidden]):not([type=radio]):not([disabled])',
  'input[type=radio]:checked',
  'textarea',
  'select'
].join(', ')

/** A field in a part of the dialog that is not drawn can't take focus. */
const isShown = (element: HTMLElement): boolean =>
  element.checkVisibility?.() ?? true

const resetField = (field: HTMLInputElement) => {
  if (field.type === 'radio') {
    field.checked = true
  } else {
    field.value = field.dataset.resetValue ?? ''
  }
}

const clearErrors = (dialog: HTMLDialogElement) => {
  for (const gone of dialog.querySelectorAll('[data-reset-remove]')) {
    gone.remove()
  }
  for (const field of dialog.querySelectorAll('[aria-invalid]')) {
    field.removeAttribute('aria-invalid')
  }
}

/** Each field back where a fresh dialog starts, then told so, so the fields that check themselves see where they stand. */
const startAfresh = (dialog: HTMLDialogElement) => {
  for (const form of dialog.querySelectorAll('form')) {
    form.reset()
  }
  clearErrors(dialog)

  const fields = [
    ...dialog.querySelectorAll<HTMLInputElement>(
      '[data-reset-value], [data-reset-checked]'
    )
  ]

  fields.forEach(resetField)
  for (const field of fields) {
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

/**
 * Opens its `<dialog>` with `showModal()`, from any button anywhere on the
 * page whose `data-modal-open` names it, so the browser moves focus in,
 * closes on Escape and makes the page behind it inert. Focus goes back to
 * that button on close.
 *
 * `data-open` opens it on arrival, as a POST answers when it renders the
 * dialog again with what was wrong. Opened from a button, it starts afresh:
 * each field back to its `data-reset-*` value and any error gone. `data-locked` refuses Escape: the reveal
 * is closed by its own Done, once the token is stored.
 */
export class Modal extends HTMLElement {
  #dialog: HTMLDialogElement | null = null
  #opener: HTMLElement | null = null

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.#onPageClick)
  }

  /** Its own dialog, the first time it is asked; null once it already has one. */
  #claim(): HTMLDialogElement | null {
    const dialog = this.#dialog ? null : this.querySelector('dialog')

    return dialog?.id ? dialog : null
  }

  enhance() {
    const dialog = this.#claim()

    if (!dialog) {
      return
    }
    this.#dialog = dialog

    document.addEventListener('click', this.#onPageClick)
    this.#listen(dialog)
    this.#guardSubmits(dialog)

    if (this.hasAttribute('data-open')) {
      this.open(this.#firstOpener(dialog.id))
    }
  }

  #listen(dialog: HTMLDialogElement) {
    dialog.addEventListener('input', () => this.#holdSubmits(dialog))
    dialog.addEventListener('change', () => this.#holdSubmits(dialog))
    dialog.addEventListener('click', (event) => {
      if ((event.target as Element).closest('[data-modal-close]')) {
        dialog.close()
      }
    })
    dialog.addEventListener('close', () => this.#opener?.focus())
    if (this.hasAttribute('data-locked')) {
      dialog.addEventListener('cancel', (event) => event.preventDefault())
    }
  }

  open(opener: HTMLElement | null, afresh = false) {
    const dialog = this.#closedDialog()

    if (!dialog) {
      return
    }
    this.#opener = opener
    if (afresh) {
      startAfresh(dialog)
    }
    holdPageGutter()
    dialog.showModal()
    this.#focusIn(dialog)
    requestAnimationFrame(() => this.#settle(dialog))
  }

  #closedDialog(): HTMLDialogElement | null {
    return this.#dialog?.open === false ? this.#dialog : null
  }

  /** After the fields inside have checked themselves, taking focus back from anything on the page that reached for it meanwhile. */
  #settle(dialog: HTMLDialogElement) {
    this.#holdSubmits(dialog)
    if (!dialog.contains(document.activeElement)) {
      this.#focusIn(dialog)
    }
  }

  #focusIn(dialog: HTMLDialogElement) {
    this.#focusTarget(dialog)?.focus()
  }

  /** A submit waits while any field inside its form says it is not ready (`data-invalid`). */
  #holdSubmits(dialog: HTMLDialogElement) {
    for (const form of dialog.querySelectorAll('form[method="post"]')) {
      const submit = form.querySelector<HTMLButtonElement>(
        'button[type="submit"]'
      )

      if (submit) {
        submit.disabled = form.querySelector('[data-invalid]') !== null
      }
    }
  }

  #onPageClick = (event: MouseEvent) => {
    const opener = (event.target as Element).closest<HTMLElement>(
      '[data-modal-open]'
    )

    if (this.#opens(opener)) {
      this.open(opener, true)
    }
  }

  #opens(opener: HTMLElement | null): opener is HTMLElement {
    return Boolean(opener) && opener?.dataset.modalOpen === this.#dialog?.id
  }

  #firstOpener(id: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      `[data-modal-open="${CSS.escape(id)}"]`
    )
  }

  /**
   * The field that was wrong, or the refusal the dialog came back with; then
   * the reveal's heading, or the first field; a dialog with none starts at
   * its heading.
   */
  #focusTarget(dialog: HTMLDialogElement): HTMLElement | null {
    const wrong = [
      ...dialog.querySelectorAll<HTMLElement>(
        '[aria-invalid="true"], [data-modal-error]'
      )
    ].find(isShown)
    const field = this.hasAttribute('data-locked')
      ? null
      : dialog.querySelector<HTMLElement>(fieldSelector)

    return wrong ?? field ?? dialog.querySelector<HTMLElement>('h2')
  }

  /** One submit per write: a second click would issue a second token nobody sees. */
  #guardSubmits(dialog: HTMLDialogElement) {
    for (const form of dialog.querySelectorAll('form[method="post"]')) {
      form.addEventListener('submit', (event) => {
        const button = (event as SubmitEvent).submitter

        if (button instanceof HTMLButtonElement) {
          button.disabled = true
        }
      })
    }

    // A bfcache restore brings the page back with the button still disabled.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        for (const button of dialog.querySelectorAll<HTMLButtonElement>(
          'button[type="submit"]'
        )) {
          button.disabled = false
        }
      }
    })
  }
}
