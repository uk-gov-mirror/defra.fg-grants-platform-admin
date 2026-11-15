/** Long enough for a screen reader to have the live region before its words arrive. */
const announceAfterMs = 100

/**
 * Says how the last write went. The words are put back into their live
 * region a moment after the page loads, because a region that already has
 * its words on arrival is not read out. A success goes after
 * `data-dismiss-after` milliseconds, unless the pointer or focus is on it;
 * anything else stays until dismissed.
 */
export class TokenToast extends HTMLElement {
  #enhanced = false
  #timer: number | undefined

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  enhance() {
    const message = this.querySelector<HTMLElement>('[data-toast-message]')
    const dismiss = this.querySelector<HTMLElement>('[data-toast-dismiss]')

    if (this.#enhanced || !message) {
      return
    }
    this.#enhanced = true

    const words = [...message.childNodes]

    message.replaceChildren()
    window.setTimeout(() => message.append(...words), announceAfterMs)

    dismiss?.addEventListener('click', () => this.remove())
    this.#dismissLater(Number(this.dataset.dismissAfter))
  }

  #dismissLater(after: number) {
    if (!(after > 0)) {
      return
    }

    this.#timer = window.setTimeout(() => this.remove(), after)
    const hold = () => window.clearTimeout(this.#timer)

    this.addEventListener('pointerenter', hold, { once: true })
    this.addEventListener('focusin', hold, { once: true })
  }
}
