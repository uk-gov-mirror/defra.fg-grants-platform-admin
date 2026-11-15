import { keepMenuKeys } from './menu-keys.ts'

/** A menu of links: the keyboard moves between them, and opening it lands on the one ticked. */
export class FilterMenu extends HTMLElement {
  #enhanced = false

  connectedCallback() {
    queueMicrotask(() => this.#enhance())
  }

  #enhance() {
    const panel = this.querySelector<HTMLElement>('[popover]')

    if (this.#enhanced || !panel) {
      return
    }
    this.#enhanced = true

    keepMenuKeys(
      panel,
      () => [...panel.querySelectorAll<HTMLElement>('a')],
      () => panel.querySelector<HTMLElement>('a[aria-current]') ?? undefined
    )
  }
}
