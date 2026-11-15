/** Sticks only from lg, where no bar sits above it, so the block alone sets how far down the table's header pins. */
export class StickyTop extends HTMLElement {
  #observer: ResizeObserver | null = null

  connectedCallback() {
    this.#observer = new ResizeObserver(() => this.measure())
    this.#observer.observe(this)
    this.measure()
  }

  disconnectedCallback() {
    this.#observer?.disconnect()
  }

  measure() {
    document.documentElement.style.setProperty(
      '--sticky-top',
      `${this.getBoundingClientRect().height}px`
    )
  }
}
