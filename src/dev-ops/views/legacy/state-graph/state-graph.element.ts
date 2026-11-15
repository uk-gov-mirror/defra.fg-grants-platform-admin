const margin = 8

/**
 * Brings the selected status into view inside its own scroll box, only when
 * it is out of view and without moving the page. While a graph is wider than
 * its box, the box's scroll hint shows and describes the box. Each stage's
 * label stays at the box's left edge for as long as its band is in view.
 */
export class StateGraph extends HTMLElement {
  #observer: ResizeObserver | null = null

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  disconnectedCallback() {
    this.#observer?.disconnect()
  }

  enhance() {
    this.#observer?.disconnect()
    this.#observer = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        this.#fit(target as HTMLElement)
      }
    })

    for (const box of this.querySelectorAll<HTMLElement>(
      '[data-graph-scroll]'
    )) {
      this.#reveal(box)
      this.#fit(box)
      this.#follow(box)
      box.addEventListener('scroll', () => this.#follow(box), {
        passive: true
      })
      this.#observer.observe(box)
    }
  }

  #reveal(box: HTMLElement) {
    const node = box.querySelector('[aria-current] rect')

    if (!node) {
      return
    }

    const left = Number(node.getAttribute('x')) - margin
    const right = left + Number(node.getAttribute('width')) + 2 * margin

    if (left < box.scrollLeft) {
      box.scrollLeft = left
    } else if (right > box.scrollLeft + box.clientWidth) {
      box.scrollLeft = right - box.clientWidth
    }
  }

  #fit(box: HTMLElement) {
    const id = box.dataset.hint
    const hint = id ? document.getElementById(id) : null

    if (!hint) {
      return
    }

    const overflows = box.scrollWidth > box.clientWidth + 1

    hint.hidden = !overflows

    if (overflows) {
      box.setAttribute('aria-describedby', hint.id)
    } else {
      box.removeAttribute('aria-describedby')
    }
  }

  #follow(box: HTMLElement) {
    for (const label of box.querySelectorAll('[data-band-label]')) {
      const start = Number(label.getAttribute('data-x'))
      const room = Number(label.getAttribute('data-room'))
      const shift = Math.min(Math.max(box.scrollLeft - start, 0), room)

      label.setAttribute('transform', `translate(${shift} 0)`)
    }
  }
}
