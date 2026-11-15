import { isPlainActivation } from '../plain-activation.ts'

/**
 * Same origin and same path: a referrer from anywhere else is not that page.
 * The query is deliberately not compared — the list carries its filters there,
 * and the list under any filter is still the list.
 */
const isSamePage = (referrer: string, href: string): boolean => {
  try {
    const from = new URL(referrer)
    const to = new URL(href, location.href)

    return from.origin === to.origin && from.pathname === to.pathname
  } catch {
    return false
  }
}

/**
 * The rendered `href` (see `toSafeFrom` in event-page.view-model.ts) already
 * returns the operator to the list with its filters. What it cannot restore is
 * where they were *in* it: the scroll position, and any extra pages pulled in
 * by Load more. `history.back()` restores both, by serving the previous page
 * from the browser's own cache — hence the upgrade, and hence its narrowness.
 *
 * Two cases look eligible but are not: a pasted link or a new tab, where there
 * is no history entry to return to; and the page after a redrive, whose POST
 * answers 303 to this same event, so back would land here again.
 */
export class Back extends HTMLElement {
  #enhanced = false

  connectedCallback() {
    // A microtask past connection, as every element here does: parsed from the
    // server's markup, the children do not exist yet when this first runs.
    queueMicrotask(() => this.#enhance())
  }

  #enhance() {
    const link = this.querySelector('a')

    if (this.#enhanced || !link || !this.#cameFrom(link.getAttribute('href'))) {
      return
    }

    this.#enhanced = true

    link.addEventListener('click', (event) => {
      if (isPlainActivation(event)) {
        event.preventDefault()
        history.back()
      }
    })
  }

  /** The link is the list, so the page to go back to is read off it rather than repeated. */
  #cameFrom(href: string | null): boolean {
    return (
      history.length > 1 && href !== null && isSamePage(document.referrer, href)
    )
  }
}
