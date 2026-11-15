/** Long enough to be read out. */
const announcedForMs = 2000

interface Parts {
  token: HTMLTextAreaElement
  copy: HTMLButtonElement
  ack: HTMLInputElement
  done: HTMLButtonElement
}

/**
 * The one time a token is shown. Copy puts it on the clipboard; Done waits
 * for the operator to say it is stored; and the token is wiped from the page
 * as it is left, so the back button or a restored tab can't show it.
 */
export class TokenReveal extends HTMLElement {
  #enhanced = false
  #timer: number | undefined

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  #parts(): Parts | null {
    const parts = {
      token: this.querySelector('[data-reveal-token]'),
      copy: this.querySelector('[data-reveal-copy]'),
      ack: this.querySelector('[data-reveal-ack]'),
      done: this.querySelector('[data-reveal-done]')
    }

    return Object.values(parts).every(Boolean)
      ? (parts as unknown as Parts)
      : null
  }

  enhance() {
    const parts = this.#enhanced ? null : this.#parts()

    if (!parts) {
      return
    }
    this.#enhanced = true

    const { token, copy, ack, done } = parts

    done.disabled = !ack.checked
    ack.addEventListener('change', () => {
      done.disabled = !ack.checked
    })
    token.addEventListener('focus', () => token.select())
    this.#leaveOnDone(done, ack)
    if (navigator.clipboard) {
      copy.hidden = false
      copy.addEventListener('click', () => this.#copy(token.value))
    }
    window.addEventListener('pagehide', () => {
      token.value = ''
      token.textContent = ''
    })
  }

  /** A GET form with no named fields leaves a bare `?` on the address, so Done goes there itself. */
  #leaveOnDone(done: HTMLButtonElement, ack: HTMLInputElement) {
    done.form?.addEventListener('submit', (event) => {
      event.preventDefault()
      if (ack.checked) {
        window.location.assign(done.form?.action ?? '/')
      }
    })
  }

  async #copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      this.#say('Token copied', 'Copied')
    } catch {
      this.#say("Couldn't copy the token. Select it and copy it instead.")
    }
  }

  #say(message: string, label = 'Copy') {
    const status = this.querySelector<HTMLElement>('[data-reveal-status]')
    const copyLabel = this.querySelector<HTMLElement>(
      '[data-reveal-copy-label]'
    )

    if (!status || !copyLabel) {
      return
    }
    status.textContent = message
    copyLabel.textContent = label
    window.clearTimeout(this.#timer)
    this.#timer = window.setTimeout(() => {
      status.textContent = ''
      copyLabel.textContent = 'Copy'
    }, announcedForMs)
  }
}
