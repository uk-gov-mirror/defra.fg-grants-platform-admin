/** The two buttons whose answer is a page to swap in; Confirm save posts and redirects as it always would. */
const swappedSubmitters =
  '[data-payload-editor-review], [data-payload-editor-back]'

/** The offset in a text of a 1-based line and column, as the scanner names them. */
export const toOffset = (
  text: string,
  line: number,
  column: number
): number => {
  const start = text
    .split('\n')
    .slice(0, line - 1)
    .reduce((offset, before) => offset + before.length + 1, 0)

  return Math.min(start + column - 1, text.length)
}

const lineCountOf = (text: string): number => text.split('\n').length

const isReviewKey = (event: KeyboardEvent): boolean =>
  event.key === 'Enter' && (event.ctrlKey || event.metaKey)

const toBody = (form: HTMLFormElement, submitter: HTMLElement) => {
  const body = new URLSearchParams()

  for (const [name, value] of new FormData(form)) {
    body.append(name, String(value))
  }

  const name = submitter.getAttribute('name')

  if (name) {
    body.append(name, submitter.getAttribute('value') ?? '')
  }

  return body
}

const actionOf = (form: HTMLFormElement, submitter: HTMLElement): string =>
  submitter.getAttribute('formaction') ?? form.getAttribute('action') ?? ''

/** A page that isn't the editor or the review, such as a conflict banner or a sign-in page, is loaded whole instead. */
const readSection = async (response: Response): Promise<HTMLElement> => {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const page = new DOMParser().parseFromString(
    await response.text(),
    'text/html'
  )
  const section = page.getElementById('payload')

  if (!section?.querySelector('do-payload-editor')) {
    throw new Error('Not a payload editor')
  }

  return section
}

interface Parts {
  text: HTMLTextAreaElement
  gutter: HTMLElement
}

type Step = 'edit' | 'review'

/**
 * The review is swapped in under a history entry of its own, so Back returns
 * to the editor as the operator left it, text and all. Only the step's name
 * goes in the entry; the sections themselves stay here, in this document, and
 * a reload forgets them.
 */
const shown = new Map<Step, HTMLElement>()

const stepOf = (state: unknown): Step =>
  (state as { payloadStep?: unknown } | null)?.payloadStep === 'review'
    ? 'review'
    : 'edit'

const stepIn = (section: HTMLElement): Step =>
  section.querySelector('do-payload-editor')?.getAttribute('data-step') ===
  'review'
    ? 'review'
    : 'edit'

const focusIn = (section: HTMLElement) =>
  section.querySelector<HTMLElement>('[data-focus-on-arrival]')?.focus()

const place = (section: HTMLElement) => {
  document.getElementById('payload')?.replaceWith(section)
  focusIn(section)
}

/** Focus waits a frame: the browser settles the entry's #payload after popstate, and that clears focus. */
const restore = (event: PopStateEvent) => {
  const section = shown.get(stepOf(event.state))

  if (section && !section.isConnected) {
    document.getElementById('payload')?.replaceWith(section)
    requestAnimationFrame(() => focusIn(section))
  }
}

let listening = false

const listen = () => {
  if (!listening) {
    listening = true
    window.addEventListener('popstate', restore)
  }
}

/** Back to editing is Back itself while the editor behind this review is still held. */
const canGoBack = (submitter: HTMLElement): boolean =>
  submitter.matches('[data-payload-editor-back]') &&
  stepOf(history.state) === 'review' &&
  shown.has('edit')

export class PayloadEditor extends HTMLElement {
  #enhanced = false
  #errorLine: number | null = null
  #drawn = ''

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  enhance() {
    if (this.#enhanced) {
      return
    }
    this.#enhanced = true
    listen()
    this.addEventListener('submit', (event) => this.#onSubmit(event))
    this.#enhanceEditor()
  }

  #parts(): Parts | null {
    const text = this.querySelector<HTMLTextAreaElement>(
      'textarea[data-payload-editor-text]'
    )
    const gutter = this.querySelector<HTMLElement>(
      '[data-payload-editor-gutter]'
    )

    return text && gutter ? { text, gutter } : null
  }

  #enhanceEditor() {
    const parts = this.#parts()

    if (!parts) {
      return
    }

    this.#enhanceGoTo(parts)
    parts.text.addEventListener('input', () => this.#onInput(parts))
    parts.text.addEventListener('scroll', () => this.#follow(parts))
    parts.text.addEventListener('keydown', (event) => this.#onKey(event))
    this.#draw(parts)
    parts.gutter.hidden = false
  }

  #enhanceGoTo(parts: Parts) {
    const goTo = this.querySelector<HTMLAnchorElement>(
      '[data-payload-editor-go-to]'
    )

    if (goTo) {
      this.#errorLine = Number(goTo.dataset.line)
      goTo.addEventListener('click', (event) => this.#goTo(event, parts))
    }
  }

  /** The line the scanner stopped on stays marked until the text changes under it. */
  #onInput(parts: Parts) {
    this.#errorLine = null
    this.#draw(parts)
  }

  /** Redrawn only when the count or the mark moves, not on every keystroke. */
  #draw(parts: Parts) {
    const count = lineCountOf(parts.text.value)
    const key = `${count}:${this.#errorLine}`

    if (key === this.#drawn) {
      return
    }

    this.#drawn = key
    parts.gutter.replaceChildren(
      ...Array.from({ length: count }, (_, index) => this.#number(index + 1))
    )
    this.#follow(parts)
  }

  #number(line: number): HTMLElement {
    const number = document.createElement('div')

    number.textContent = String(line)
    number.toggleAttribute('data-error', line === this.#errorLine)

    return number
  }

  #follow(parts: Parts) {
    parts.gutter.scrollTop = parts.text.scrollTop
  }

  /** Neither key is advertised: Escape moves to Discard rather than discarding, so nothing typed is lost to a stray key. */
  #onKey(event: KeyboardEvent) {
    if (isReviewKey(event)) {
      event.preventDefault()
      this.#find('[data-payload-editor-review]').click()
    }

    if (event.key === 'Escape') {
      this.#find('[data-payload-editor-discard]').focus()
    }
  }

  /** Both are in the editor's own markup, so a missing one is a stand-in that does nothing. */
  #find(selector: string): HTMLElement {
    return (
      this.querySelector<HTMLElement>(selector) ?? document.createElement('a')
    )
  }

  /** Puts the caret where the scanner stopped, rather than only scrolling the textarea into view. */
  #goTo(event: MouseEvent, parts: Parts) {
    const link = event.currentTarget as HTMLElement
    const offset = toOffset(
      parts.text.value,
      Number(link.dataset.line),
      Number(link.dataset.column)
    )

    event.preventDefault()
    parts.text.focus()
    parts.text.setSelectionRange(offset, offset)
  }

  async #onSubmit(event: SubmitEvent) {
    const form = event.target as HTMLFormElement
    const submitter = event.submitter

    if (!submitter?.matches(swappedSubmitters)) {
      return
    }

    event.preventDefault()
    if (canGoBack(submitter)) {
      history.back()
    } else {
      await this.#swapOrSubmit(form, submitter)
    }
  }

  async #swapOrSubmit(form: HTMLFormElement, submitter: HTMLElement) {
    try {
      await this.#swap(form, submitter)
    } catch {
      this.#submitWhole(form, submitter)
    }
  }

  async #swap(form: HTMLFormElement, submitter: HTMLElement) {
    const response = await fetch(actionOf(form, submitter), {
      method: 'POST',
      headers: { accept: 'text/html' },
      body: toBody(form, submitter),
      credentials: 'same-origin'
    })
    const section = document.importNode(await readSection(response), true)

    this.#show(section)
  }

  #show(section: HTMLElement) {
    const current = this.closest<HTMLElement>('#payload')
    const next = stepIn(section)

    place(section)
    if (
      current &&
      this.getAttribute('data-step') === 'edit' &&
      next === 'review'
    ) {
      shown.set('edit', current)
      history.pushState({ payloadStep: 'review' }, '')
    }
    shown.set(next, section)
  }

  /** The post the form would have made without this element, button and all. */
  #submitWhole(form: HTMLFormElement, submitter: HTMLElement) {
    const name = submitter.getAttribute('name')

    if (name) {
      const input = document.createElement('input')

      input.type = 'hidden'
      input.name = name
      input.value = submitter.getAttribute('value') ?? ''
      form.append(input)
    }

    form.action = actionOf(form, submitter)
    form.submit()
  }
}
