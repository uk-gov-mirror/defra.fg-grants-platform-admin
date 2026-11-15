import { keepMenuKeys } from './menu-keys.ts'

export class ChoiceMenu extends HTMLElement {
  #enhanced = false

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  #parts() {
    const fallback = this.querySelector<HTMLSelectElement>(
      '[data-choice-fallback]'
    )
    const value = this.querySelector<HTMLInputElement>('[data-choice-value]')
    const trigger = this.querySelector<HTMLButtonElement>(
      '[data-choice-trigger]'
    )
    const label = this.querySelector<HTMLElement>('[data-choice-label]')
    const panel = this.querySelector<HTMLElement>('[popover]')

    return [fallback, value, trigger, label, panel].every(Boolean)
      ? {
          fallback: fallback!,
          value: value!,
          trigger: trigger!,
          label: label!,
          panel: panel!
        }
      : null
  }

  #options() {
    return [...this.querySelectorAll<HTMLButtonElement>('button[data-value]')]
  }

  #choose(chosen: string) {
    for (const option of this.#options()) {
      const active = option.dataset.value === chosen

      option.setAttribute('aria-pressed', String(active))
      option.classList.toggle('font-semibold', active)
      option.querySelector('svg')?.classList.toggle('invisible', !active)
    }
  }

  enhance() {
    const parts = this.#enhanced ? null : this.#parts()

    if (!parts) {
      return
    }
    this.#enhanced = true

    const { fallback, value, trigger, label, panel } = parts
    const choose = (option: HTMLButtonElement) => {
      value.value = option.dataset.value!
      label.textContent = option.textContent.trim()
      this.#choose(value.value)
    }

    // A reload can hand the select back a choice the page was not rendered with.
    const restored = this.#options().find(
      (option) => option.dataset.value === fallback.value
    )

    if (restored) {
      choose(restored)
    }
    fallback.remove()
    value.disabled = false
    trigger.hidden = false
    keepMenuKeys(
      panel,
      () => this.#options(),
      () =>
        this.#options().find((option) => option.dataset.value === value.value)
    )

    panel.addEventListener('click', (event) => {
      const option = (event.target as Element).closest<HTMLButtonElement>(
        'button[data-value]'
      )

      if (option) {
        choose(option)
        panel.hidePopover()
        trigger.focus()
      }
    })
  }
}
