const fallbackMax = 500

/** Silence until the end is in sight, so a live region does not read every keystroke. */
const announceWithin = 50

const countMessage = (used: number, max: number): string => `${used} / ${max}`

const remainingMessage = (remaining: number): string => {
  const characters = Math.abs(remaining) === 1 ? 'character' : 'characters'

  return remaining < 0
    ? `${Math.abs(remaining)} ${characters} too many`
    : `${remaining} ${characters} remaining`
}

const toMax = (value: string | undefined): number => {
  const max = Number(value)

  return Number.isInteger(max) && max > 0 ? max : fallbackMax
}

interface Parts {
  field: HTMLTextAreaElement
  count: HTMLElement
  status: HTMLElement
}

export class CharCount extends HTMLElement {
  #announced: string | null = null

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  #parts(): Parts | null {
    const field = this.querySelector('textarea')
    const count = this.querySelector<HTMLElement>('[data-char-count-value]')
    const status = this.querySelector<HTMLElement>('[data-char-count-status]')

    return field && count && status ? { field, count, status } : null
  }

  enhance() {
    const parts = this.#parts()

    if (!parts) {
      return
    }

    const max = toMax(this.dataset.max)
    const show = () => this.#show(parts, max)

    parts.field.addEventListener('input', show)
    show()
  }

  #show(parts: Parts, max: number) {
    const used = parts.field.value.length

    parts.count.textContent = countMessage(used, max)
    this.#announce(parts, max - used)
  }

  #announce(parts: Parts, remaining: number) {
    const message =
      remaining <= announceWithin ? remainingMessage(remaining) : ''

    if (message !== this.#announced) {
      this.#announced = message
      parts.status.textContent = message
    }
  }
}
