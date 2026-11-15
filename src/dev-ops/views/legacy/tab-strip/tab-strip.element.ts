/** A row of tabs that scrolls on a phone: the open one is brought into view, within the row only. */
export class TabStrip extends HTMLElement {
  connectedCallback() {
    queueMicrotask(() => this.#showCurrent())
  }

  #showCurrent() {
    const current = this.querySelector<HTMLElement>('[aria-current]')

    if (current && this.scrollWidth > this.clientWidth) {
      this.scrollLeft =
        current.offsetLeft - (this.clientWidth - current.offsetWidth) / 2
    }
  }
}
