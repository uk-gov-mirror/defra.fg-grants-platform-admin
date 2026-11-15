import { clientNamePattern } from '../../../view-models/access-token-forms.ts'

const plural = (count: number): string =>
  `${count} working token${count === 1 ? '' : 's'}`

/**
 * Checks the name as it is typed, as the dialog's Create waits for one that
 * passes, and says when the client already has working tokens, and which way
 * a replacement goes instead.
 */
export class ClientField extends HTMLElement {
  #enhanced = false

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  #counts(): Record<string, number> {
    try {
      return JSON.parse(this.dataset.activeCounts ?? '{}')
    } catch {
      return {}
    }
  }

  #parts() {
    const parts = {
      input: this.querySelector('input'),
      error: this.querySelector('[data-client-error]'),
      active: this.querySelector('[data-client-active]')
    }

    return Object.values(parts).every(Boolean)
      ? (parts as {
          input: HTMLInputElement
          error: HTMLElement
          active: HTMLElement
        })
      : null
  }

  #activeLine(name: string, counts: Record<string, number>): string {
    return Object.hasOwn(counts, name)
      ? `${name} already has ${plural(counts[name])}. If this replaces one, rotate that token instead.`
      : ''
  }

  enhance() {
    const parts = this.#enhanced ? null : this.#parts()

    if (!parts) {
      return
    }
    this.#enhanced = true

    const counts = this.#counts()
    const check = () => {
      const name = parts.input.value.trim()
      const wrong = name !== '' && !clientNamePattern.test(name)

      this.toggleAttribute('data-invalid', name === '' || wrong)
      parts.active.textContent = wrong ? '' : this.#activeLine(name, counts)

      return wrong
    }
    // An error the server sent back stands until the name is changed.
    const update = () => {
      const wrong = check()

      parts.error.textContent =
        'Use lowercase letters, digits and hyphens only.'
      parts.error.hidden = !wrong
      if (wrong) {
        parts.input.setAttribute('aria-invalid', 'true')
      } else {
        parts.input.removeAttribute('aria-invalid')
      }
    }

    parts.input.addEventListener('input', update)
    check()
  }
}
