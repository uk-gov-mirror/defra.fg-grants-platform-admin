import type {
  ExpiryChoice,
  ExpiryInput
} from '../../../view-models/access-token-forms.ts'
import {
  parseExpiry,
  toExpirySummary
} from '../../../view-models/access-token-forms.ts'

/** Read by property: a radio's checkedness is not its attribute. */
const chosenExpiry = (picker: HTMLElement): ExpiryChoice =>
  ([...picker.querySelectorAll<HTMLInputElement>('input[name="expiry"]')].find(
    (radio) => radio.checked
  )?.value ?? 'never') as ExpiryChoice

const readInput = (picker: HTMLElement): ExpiryInput => ({
  current: picker.dataset.current,
  expiry: chosenExpiry(picker),
  date:
    picker.querySelector<HTMLInputElement>('input[name="date"]')?.value ?? ''
})

const withoutId = (field: Element, id: string) => {
  const rest = (field.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((describedBy) => describedBy !== id)

  if (rest.length > 0) {
    field.setAttribute('aria-describedby', rest.join(' '))
  } else {
    field.removeAttribute('aria-describedby')
  }
}

/** The server's error was about what was sent: once the choice changes, the summary speaks for it. */
const dropServerError = (picker: HTMLElement) => {
  const error = picker.querySelector('[data-expiry-error]')

  if (!error) {
    return
  }
  error.remove()
  for (const field of picker.querySelectorAll(
    `[aria-describedby~="${error.id}"]`
  )) {
    withoutId(field, error.id)
  }
  picker.querySelector('input[name="date"]')?.removeAttribute('aria-invalid')
}

/** Keeps the line under the picker saying the date the choice comes to, by the same rule the server reads it with. */
export class ExpiryPicker extends HTMLElement {
  #enhanced = false

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  enhance() {
    const summary = this.querySelector<HTMLElement>('[data-expiry-summary]')

    if (this.#enhanced || !summary) {
      return
    }
    this.#enhanced = true

    const update = () => {
      const input = readInput(this)
      const now = new Date()

      summary.textContent = toExpirySummary(input, now)
      this.toggleAttribute('data-invalid', !parseExpiry(input, now).ok)
    }

    const changed = () => {
      dropServerError(this)
      update()
    }

    this.addEventListener('change', changed)
    this.addEventListener('input', changed)
    update()
  }
}
