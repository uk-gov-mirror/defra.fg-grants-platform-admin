import { holdPageGutter } from '../page-gutter.ts'

const inDialog = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('dialog') !== null

/** About half a second of frames: daisyUI holds the drawer hidden for a tenth of a second as it opens, and hidden can't take focus. */
const focusFrames = 30

/** Gives up once a dialog has opened over the drawer: focus is the dialog's then. */
const stillWaiting = (target: HTMLElement, frames: number): boolean =>
  frames > 0 &&
  document.activeElement !== target &&
  document.querySelector('dialog[open]') === null

const focusWhenShown = (target: HTMLElement, frames = focusFrames) => {
  target.focus()
  if (stillWaiting(target, frames)) {
    requestAnimationFrame(() => focusWhenShown(target, frames - 1))
  }
}

/** A click anywhere on a row opens it through the row's one button, unless it ends a text selection. */
const rowOpener = (target: Element): HTMLElement | null => {
  const row = target.closest('[data-drawer-row]')

  return row && !document.getSelection()?.toString()
    ? row.querySelector<HTMLElement>('[data-drawer-open]')
    : null
}

const openerFor = (target: Element): HTMLElement | null =>
  target.closest<HTMLElement>('[data-drawer-open]') ?? rowOpener(target)

const focusable =
  'button, [href], input:not([type="hidden"]), summary, [tabindex]:not([tabindex="-1"])'

/** What Tab can reach in a panel, in order; a disabled-looking button stays reachable, as `aria-disabled` is. */
const focusablesIn = (panel: HTMLElement): HTMLElement[] =>
  [...panel.querySelectorAll<HTMLElement>(focusable)].filter(
    (element) => !element.matches(':disabled')
  )

/** The item Tab would leave the panel from, and the one it comes round to. */
const ends = (items: HTMLElement[], backwards: boolean) =>
  backwards ? [items[0], items.at(-1)] : [items.at(-1), items[0]]

/** Where Tab goes next, if it would otherwise leave the panel; from its heading or from outside, the panel's own first or last. */
const wrapTarget = (
  items: HTMLElement[],
  backwards: boolean
): HTMLElement | undefined => {
  const [edge, wrapTo] = ends(items, backwards)
  const active = document.activeElement as HTMLElement

  return active === edge || !items.includes(active) ? wrapTo : undefined
}

/**
 * The token details on the right, one token's panel at a time, drawn from
 * the page's own markup. daisyUI's drawer is a checkbox; this adds what a
 * checkbox can't: focus moves to the panel's heading, the page behind is
 * inert while it is open, Escape closes it, and focus goes back to the row's
 * Open button.
 */
export class TokenDrawer extends HTMLElement {
  #enhanced = false
  #opener: HTMLElement | null = null

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  #parts() {
    const toggle = this.querySelector<HTMLInputElement>('[data-drawer-toggle]')
    const page = this.querySelector<HTMLElement>('[data-drawer-page]')

    return toggle && page ? { toggle, page } : null
  }

  enhance() {
    const parts = this.#enhanced ? null : this.#parts()

    if (!parts) {
      return
    }
    this.#enhanced = true

    this.addEventListener('click', (event) => {
      const target = event.target as Element
      const opener = openerFor(target)

      if (opener) {
        this.open(opener.dataset.drawerOpen ?? '', opener)
      } else if (target.closest('[data-drawer-close]')) {
        this.close()
      }
    })
    // The overlay is a label for the checkbox, so a click on it lands here.
    parts.toggle.addEventListener('change', () => {
      if (!parts.toggle.checked) {
        this.#closed()
      }
    })
    // On the document, as focus may still be on its way into the drawer. A
    // dialog's keys are the dialog's.
    document.addEventListener('keydown', (event) => {
      if (parts.toggle.checked && !inDialog(event.target)) {
        this.#onKey(event)
      }
    })

    const arriving = this.dataset.openToken

    if (arriving) {
      this.open(arriving, this.#openerOf(arriving))
    }
  }

  /** Escape closes; Tab goes round the open panel rather than out to the page's navigation. */
  #onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.close()
    } else if (event.key === 'Tab') {
      this.#trap(event)
    }
  }

  #trap(event: KeyboardEvent) {
    const panel = this.querySelector<HTMLElement>(
      '[data-token-panel]:not([hidden])'
    )
    const next = panel ? wrapTarget(focusablesIn(panel), event.shiftKey) : null

    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  #openerOf(tokenId: string): HTMLElement | null {
    return this.querySelector<HTMLElement>(
      `[data-drawer-open="${CSS.escape(tokenId)}"]`
    )
  }

  /** Shows that token's panel alone, answering it; null for a token with none. */
  #show(tokenId: string): HTMLElement | null {
    const panels = [...this.querySelectorAll<HTMLElement>('[data-token-panel]')]

    for (const panel of panels) {
      panel.hidden = panel.dataset.tokenPanel !== tokenId
    }

    return panels.find((panel) => !panel.hidden) ?? null
  }

  open(tokenId: string, opener: HTMLElement | null) {
    const parts = this.#parts()
    const shown = this.#show(tokenId)

    if (!parts || !shown) {
      return
    }
    this.#opener = opener
    holdPageGutter()
    parts.toggle.checked = true
    parts.page.inert = true
    const heading = shown.querySelector<HTMLElement>('[data-drawer-heading]')

    if (heading) {
      focusWhenShown(heading)
    }
  }

  close() {
    const parts = this.#parts()

    if (parts?.toggle.checked) {
      parts.toggle.checked = false
      this.#closed()
    }
  }

  #closed() {
    const parts = this.#parts()

    if (parts) {
      parts.page.inert = false
    }
    this.#opener?.focus({ preventScroll: true })
  }
}
