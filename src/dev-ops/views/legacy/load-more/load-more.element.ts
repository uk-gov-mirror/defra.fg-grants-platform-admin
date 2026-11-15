const preloadMarginPx = 600

const announceEveryMs = 1500

export interface Noun {
  one: string
  many: string
}

export const loadedMessage = (count: number, noun: Noun): string =>
  `${count} more ${count === 1 ? noun.one : noun.many} loaded`

/** What to look for in a fetched page, all set by the list through data attributes. */
interface PageSelectors {
  rowLink?: string
  outage?: string
  empty?: string
  partial?: string
}

const selectorsOf = ({
  rowLink,
  pageOutage,
  pageEmpty,
  pagePartial
}: DOMStringMap): PageSelectors => ({
  rowLink,
  outage: pageOutage,
  empty: pageEmpty,
  partial: pagePartial
})

const nounOf = ({ nounOne, nounMany }: DOMStringMap): Noun | null =>
  nounOne && nounMany ? { one: nounOne, many: nounMany } : null

interface Page {
  rows: Node[][]
  next: string | null
  partial: string | null
  /** What the list says after its last row, such as where a search stopped. */
  tail: Node | null
  /** The list is not over although no page follows: the tail says how to go on. */
  open: boolean
  /** The tail says the list is over in its own words, so "No more" would say it twice. */
  closed: boolean
}

const find = (root: ParentNode, selector?: string): Element | null =>
  selector ? root.querySelector(selector) : null

/** A 200 is not always a page of rows: an outage can be a 200 too. */
const isPageOfRows = (page: Document, selectors: PageSelectors): boolean =>
  !find(page, selectors.outage) &&
  Boolean(find(page, 'do-load-more') ?? find(page, selectors.empty))

const nextPageOf = (page: Document): string | null =>
  page.querySelector('do-load-more')?.getAttribute('data-next-page') ?? null

/** Said by the list, or by the tail of a page that found no rows and so draws no list. */
const isOpen = (page: Document): boolean =>
  page.querySelector('[data-open]') !== null

const isClosed = (page: Document): boolean =>
  page.querySelector('[data-closed]') !== null

/** A page with no rows says its end in its empty line and hides its tail; under rows, the tail says it. */
const unhideClosed = (tail: Node): Node => {
  if (tail instanceof HTMLElement && tail.hasAttribute('data-closed')) {
    tail.hidden = false
  }

  return tail
}

const tailOf = (page: Document, id?: string): Node | null => {
  const tail = id ? page.querySelector(`[id="${id}"]`) : null

  return tail ? document.importNode(tail, true) : null
}

const partialOf = (page: Document, selector?: string): string | null =>
  find(page, selector)?.textContent?.trim() ?? null

/** Every container the rows are drawn in, or none if any is missing. */
const rowsOf = (ids = ''): HTMLElement[] | null => {
  const rows = ids
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id))

  return rows.length > 0 && rows.every(Boolean) ? (rows as HTMLElement[]) : null
}

const readPage = (
  page: Document,
  rowsIds: string[],
  selectors: PageSelectors,
  tailId?: string
): Page => ({
  rows: rowsIds.map((rowsId) =>
    [...page.querySelectorAll(`[id="${rowsId}"] > *`)].map((row) =>
      document.importNode(row, true)
    )
  ),
  next: nextPageOf(page),
  partial: partialOf(page, selectors.partial),
  tail: tailOf(page, tailId),
  open: isOpen(page),
  closed: isClosed(page)
})

const fetchPage = async (
  href: string,
  rowsIds: string[],
  selectors: PageSelectors,
  tailId?: string
): Promise<Page> => {
  const response = await fetch(href, {
    headers: { accept: 'text/html' },
    credentials: 'same-origin'
  })

  // A redirect answers with some other page: never rows to add to these.
  if (!response.ok || response.redirected) {
    throw new Error(`HTTP ${response.status}`)
  }

  const page = new DOMParser().parseFromString(
    await response.text(),
    'text/html'
  )

  if (!isPageOfRows(page, selectors)) {
    throw new Error('Not a page of rows')
  }

  return readPage(page, rowsIds, selectors, tailId)
}

interface Parts {
  /** The table body, and any other drawing of the same rows, such as a phone list. */
  rows: HTMLElement[]
  busy: HTMLElement[]
  noun: Noun
  sentinel: HTMLElement
  spinner: HTMLElement
  end: HTMLElement
  partial: HTMLElement
  error: HTMLElement
  retry: HTMLButtonElement
  status: HTMLElement
}

export class LoadMore extends HTMLElement {
  #parts: Parts | null = null
  #selectors: PageSelectors = {}
  #next: string | null = null
  #busy = false
  #failed = false
  #observer: IntersectionObserver | null = null
  #pending = 0
  #pendingPartial: string | null = null
  #pendingEnd = false
  #retryHref: string | null = null
  #timer: number | undefined

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  disconnectedCallback() {
    this.#observer?.disconnect()
  }

  #find(): Parts | null {
    const rows = rowsOf(this.dataset.rows)

    if (!rows) {
      return null
    }

    const parts = {
      rows,
      busy: rows.map((row) => row.closest('table') ?? row),
      noun: nounOf(this.dataset),
      sentinel: this.querySelector('[data-load-more-sentinel]'),
      spinner: this.querySelector('[data-load-more-spinner]'),
      end: this.querySelector('[data-load-more-end]'),
      partial: this.querySelector('[data-load-more-partial]'),
      error: this.querySelector('[data-load-more-error]'),
      retry: this.querySelector('[data-load-more-retry]'),
      status: this.querySelector('[data-load-more-status]')
    }

    return Object.values(parts).every(Boolean)
      ? (parts as unknown as Parts)
      : null
  }

  enhance() {
    const parts = this.#parts ? null : this.#find()

    if (!parts) {
      return
    }
    this.#parts = parts
    this.#next = this.dataset.nextPage ?? null
    this.#selectors = selectorsOf(this.dataset)
    parts.retry.addEventListener('click', () => this.#retry(parts))
    this.#startWatching(parts)
  }

  #startWatching(parts: Parts) {
    try {
      this.#watch(parts)
    } catch {
      return
    }
    this.#hideFallback()
  }

  /** Only once it is actually watching: otherwise the link stays as the way on. */
  #hideFallback() {
    const link = this.querySelector<HTMLElement>('[data-load-more-link]')

    if (link) {
      link.hidden = true
    }
  }

  #watch(parts: Parts) {
    if (!this.#next) {
      return
    }

    this.#observer?.disconnect()
    this.#observer = new IntersectionObserver(
      (entries) => this.#onIntersect(parts, entries),
      { rootMargin: `0px 0px ${preloadMarginPx}px 0px` }
    )
    this.#observer.observe(parts.sentinel)
  }

  #onIntersect(parts: Parts, entries: IntersectionObserverEntry[]) {
    if (entries.some((entry) => entry.isIntersecting)) {
      this.#load(parts)
    }
  }

  #canLoad(): boolean {
    return !this.#busy && !this.#failed && this.#next !== null
  }

  async #load(parts: Parts) {
    if (!this.#canLoad()) {
      return
    }

    this.#setBusy(parts, true)
    try {
      await this.#append(parts, this.#next ?? '')
    } catch {
      this.#fail(parts)
    }
    this.#setBusy(parts, false)
    this.#keepFilling(parts)
  }

  async #append(parts: Parts, href: string) {
    const { rows, next, partial, tail, open, closed } = await fetchPage(
      href,
      parts.rows.map((container) => container.id),
      this.#selectors,
      this.dataset.tail
    )
    const fresh = parts.rows.map((container, index) =>
      this.#withoutShown(container, rows[index])
    )

    parts.rows.forEach((container, index) => container.append(...fresh[index]))
    this.#next = next
    this.#showPartialNotice(parts, partial)
    this.#showTail(tail)
    if (next === null) {
      this.#end(parts, href, partial, open || closed)
    }
    // Every container draws the same rows, so the first one counts them.
    this.#queueAnnouncement(parts, fresh[0].length, partial)
  }

  #hrefOf(row: Element): string | null {
    return find(row, this.#selectors.rowLink)?.getAttribute('href') ?? null
  }

  /** A retried page can repeat rows already shown. */
  #withoutShown(container: HTMLElement, rows: Node[]): Node[] {
    const shown = new Set(
      [...container.children].map((row) => this.#hrefOf(row)).filter(Boolean)
    )

    return rows.filter((row) => {
      const href = row instanceof Element ? this.#hrefOf(row) : null

      return href === null || !shown.has(href)
    })
  }

  /** A partial last page may only look like the end: offer to ask for it again. A tail that speaks for the end leaves nothing to add. */
  #end(parts: Parts, href: string, partial: string | null, tailed: boolean) {
    this.#observer?.disconnect()
    if (tailed) {
      return
    }
    if (partial === null) {
      parts.end.hidden = false
      this.#pendingEnd = true
      return
    }
    this.#retryHref = href
    parts.retry.hidden = false
  }

  /** The last page loaded speaks for the whole list, so its tail takes the place of the one drawn. */
  #showTail(tail: Node | null) {
    const shown = document.getElementById(this.dataset.tail ?? '')

    if (shown && tail) {
      shown.replaceWith(unhideClosed(tail))
    }
  }

  #showPartialNotice(parts: Parts, partial: string | null) {
    if (partial !== null) {
      parts.partial.textContent = partial
      parts.partial.hidden = false
    }
  }

  #setBusy(parts: Parts, busy: boolean) {
    this.#busy = busy
    parts.spinner.hidden = !busy
    for (const element of parts.busy) {
      element.setAttribute('aria-busy', String(busy))
    }
  }

  #keepFilling(parts: Parts) {
    requestAnimationFrame(() => {
      const near =
        parts.sentinel.getBoundingClientRect().top <
        window.innerHeight + preloadMarginPx

      if (near && this.#canLoad()) {
        this.#load(parts)
      }
    })
  }

  #fail(parts: Parts) {
    this.#failed = true
    parts.error.textContent = `More ${parts.noun.many} could not be loaded.`
    parts.error.hidden = false
    parts.retry.hidden = false
  }

  #retry(parts: Parts) {
    this.#failed = false
    parts.error.hidden = true
    parts.retry.hidden = true
    if (this.#retryHref !== null) {
      this.#next = this.#retryHref
      this.#retryHref = null
      this.#watch(parts)
    }
    this.#load(parts)
  }

  #queueAnnouncement(parts: Parts, count: number, partial: string | null) {
    this.#pending += count
    this.#pendingPartial = partial ?? this.#pendingPartial

    if (this.#hasNews()) {
      this.#timer ??= window.setTimeout(
        () => this.#announce(parts),
        announceEveryMs
      )
    }
  }

  #hasNews(): boolean {
    return (
      this.#pending > 0 || this.#pendingPartial !== null || this.#pendingEnd
    )
  }

  #announce(parts: Parts) {
    const message = [
      this.#pending > 0 ? loadedMessage(this.#pending, parts.noun) : null,
      this.#pendingPartial,
      this.#pendingEnd ? `No more ${parts.noun.many}` : null
    ]
      .filter(Boolean)
      .join('. ')

    parts.status.textContent = ''
    requestAnimationFrame(() => {
      parts.status.textContent = message
    })
    this.#pending = 0
    this.#pendingPartial = null
    this.#pendingEnd = false
    this.#timer = undefined
  }
}
