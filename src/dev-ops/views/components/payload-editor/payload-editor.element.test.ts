// @vitest-environment happy-dom

import type { EventDetail } from '../../../use-cases/get-event.use-case.ts'
import { toEventPage } from '../../../view-models/event-page.view-model.ts'
import type { PayloadEditInput } from '../../../view-models/payload-edit.ts'
import { environment } from '../../../view-options.ts'
import { PayloadEditor, toOffset } from './payload-editor.element.ts'

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const key = { service: 'gas', box: 'outbox', id } as const
const page = `/dev-ops/events/gas/outbox/${id}`

const event: EventDetail = {
  ...key,
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  targetTopic: 'gas__sns__update_case_status_fifo',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  attempts: '5/5',
  createdAt: '2026-06-16T10:00:00.000Z',
  lastError: null,
  attemptHistory: [],
  payload: { data: { sheetId: 12345, parcelId: '0000' } },
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null,
  payloadRevision: 3
}

const stored = JSON.stringify(event.payload, null, 2)

const edited = stored.replace('12345', '"12345"')

const from = '?status=DEAD_LETTER'

/** The event page exactly as the server renders it, so the element meets its real markup. */
const renderPage = (
  edit?: PayloadEditInput,
  query: Parameters<typeof toEventPage>[2] = { edit: 'payload', from },
  notice?: Parameters<typeof toEventPage>[3]
): string =>
  environment.render('event.njk', {
    pageTitle: 'Event',
    getAssetPath: () => '',
    ...toEventPage(
      { outcome: 'found', event },
      key,
      query,
      notice,
      undefined,
      edit
    )
  })

const reviewPage = renderPage({
  step: 'review',
  text: edited,
  revision: 3,
  note: '',
  noteError: null
})

const brokenEditorPage = renderPage({
  step: 'edit',
  text: edited.replace('"12345"', '"12345",'),
  revision: 3,
  problem: {
    kind: 'unreadable',
    fault: { line: 5, column: 3, expected: 'a property name in double quotes' }
  }
})

const conflictPage = renderPage(
  undefined,
  { from },
  {
    outcome: 'conflict',
    status: 'Completed',
    action: 'edit',
    page
  }
)

const staleEditorPage = renderPage({
  step: 'edit',
  text: edited,
  revision: 4,
  problem: { kind: 'stale' }
})

const answer = (html: string, ok = true) => ({
  ok,
  status: ok ? 200 : 502,
  text: async () => html
})

const fetchMock = vi.fn()

const mountPage = async (html: string) => {
  await import('../index.ts')
  document.body.innerHTML =
    new DOMParser().parseFromString(html, 'text/html').querySelector('main')
      ?.outerHTML ?? ''
  await vi.advanceTimersByTimeAsync(0)

  const part = <T extends HTMLElement = HTMLElement>(testId: string) =>
    document.querySelector<T>(`[data-testid="${testId}"]`)!

  return {
    part,
    text: part<HTMLTextAreaElement>('event-payload-editor-text'),
    gutter: part('event-payload-editor-gutter'),
    numbers: () =>
      [...part('event-payload-editor-gutter').children].map(
        (number) => number.textContent
      )
  }
}

const mountEditor = async () => mountPage(renderPage())

const press = (target: HTMLElement, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init
  })

  target.dispatchEvent(event)

  return event
}

const sentBody = (): URLSearchParams =>
  fetchMock.mock.calls[0][1].body as URLSearchParams

describe('do-payload-editor', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'queueMicrotask', 'requestAnimationFrame']
    })
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = ''
    history.replaceState(null, '')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('registers the custom element', async () => {
    await mountEditor()

    expect(customElements.get('do-payload-editor')).toBe(PayloadEditor)
  })

  test('numbers every line in a gutter it then shows', async () => {
    const { text, gutter, numbers } = await mountEditor()

    expect(gutter.hidden).toBe(false)
    expect(numbers()).toEqual(
      text.value.split('\n').map((_, index) => String(index + 1))
    )
  })

  test('renumbers as lines come and go', async () => {
    const { text, numbers } = await mountEditor()

    text.value = `${stored}\n\n`
    text.dispatchEvent(new Event('input'))

    expect(numbers()).toHaveLength(8)
  })

  test('keeps the gutter level with the text as it scrolls', async () => {
    const { text, gutter } = await mountEditor()

    text.scrollTop = 40
    text.dispatchEvent(new Event('scroll'))

    expect(gutter.scrollTop).toBe(text.scrollTop)
  })

  test('marks the line the scanner stopped on, until the text changes', async () => {
    const { text, gutter } = await mountPage(brokenEditorPage)

    const marked = () =>
      [...gutter.querySelectorAll('[data-error]')].map(
        (number) => number.textContent
      )

    expect(marked()).toEqual(['5'])

    text.value = `${text.value}\n`
    text.dispatchEvent(new Event('input'))

    expect(marked()).toEqual([])
  })

  test('puts the caret where the scanner stopped when the link is followed', async () => {
    const { text, part } = await mountPage(brokenEditorPage)

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })

    part('event-payload-editor-go-to').dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(text)
    expect(text.selectionStart).toBe(toOffset(text.value, 5, 3))
  })

  test.each([
    ['Ctrl+Enter', { ctrlKey: true }],
    ['Cmd+Enter', { metaKey: true }]
  ])('reviews on %s', async (_name, modifier) => {
    fetchMock.mockResolvedValue(answer(reviewPage))

    const { text } = await mountEditor()

    const event = press(text, { key: 'Enter', ...modifier })
    await vi.advanceTimersByTimeAsync(0)

    expect(event.defaultPrevented).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('leaves a plain Enter to the textarea', async () => {
    const { text } = await mountEditor()

    const event = press(text, { key: 'Enter' })

    expect(event.defaultPrevented).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('moves focus to Discard on Escape, discarding nothing', async () => {
    const { text, part } = await mountEditor()

    text.value = edited
    press(text, { key: 'Escape' })

    expect(document.activeElement).toBe(part('event-payload-editor-discard'))
    expect(text.value).toBe(edited)
  })

  test('posts the review in the background, as the form would have', async () => {
    fetchMock.mockResolvedValue(answer(reviewPage))

    const { text, part } = await mountEditor()

    text.value = edited
    part('event-payload-editor-review').click()
    await vi.advanceTimersByTimeAsync(0)

    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe(`${page}/payload/review#payload`)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ accept: 'text/html' })
    expect(Object.fromEntries(sentBody())).toEqual({
      from: '?status=DEAD_LETTER',
      revision: '3',
      text: edited
    })
  })

  test('swaps the review into the card and puts focus on its heading', async () => {
    fetchMock.mockResolvedValue(answer(reviewPage))

    const { part } = await mountEditor()

    part('event-payload-editor-review').click()
    await vi.advanceTimersByTimeAsync(0)

    expect(document.querySelectorAll('#payload')).toHaveLength(1)
    expect(part('event-payload-editor')).toBeNull()
    expect(part('event-payload-review')).not.toBeNull()
    expect(document.activeElement).toBe(part('event-payload-heading'))
    expect(document.activeElement?.textContent).toBe('Review your changes')
  })

  test('swaps a parse error in and puts focus on the alert', async () => {
    fetchMock.mockResolvedValue(answer(brokenEditorPage))

    const { part } = await mountEditor()

    part('event-payload-editor-review').click()
    await vi.advanceTimersByTimeAsync(0)

    expect(document.activeElement).toBe(part('event-payload-editor-alert'))
  })

  test('goes back to editing in the background, saying which button it was', async () => {
    fetchMock.mockResolvedValue(answer(renderPage()))

    const { part } = await mountPage(reviewPage)

    part('event-edit-back').click()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock.mock.calls[0][0]).toBe(`${page}/payload/review#payload`)
    expect(sentBody().get('back')).toBe('edit')
    expect(sentBody().get('text')).toBe(edited)
    expect(document.activeElement).toBe(part('event-payload-editor-text'))
  })

  test('enhances the editor it swapped in', async () => {
    fetchMock.mockResolvedValue(answer(renderPage()))

    const { part } = await mountPage(reviewPage)

    part('event-edit-back').click()
    await vi.advanceTimersByTimeAsync(0)

    expect(part('event-payload-editor-gutter').hidden).toBe(false)
  })

  test('swaps in the editor a stale review answers with, text kept', async () => {
    fetchMock.mockResolvedValue(answer(staleEditorPage))

    const { part } = await mountEditor()

    part('event-payload-editor-review').click()
    await vi.advanceTimersByTimeAsync(0)

    expect(
      part<HTMLTextAreaElement>('event-payload-editor-text').value
    ).toContain(edited)
    expect(part('event-payload-current')).not.toBeNull()
    expect(document.activeElement).toBe(part('event-payload-editor-alert'))
  })

  test('gives the review a history entry of its own, naming only the step', async () => {
    fetchMock.mockResolvedValue(answer(reviewPage))

    const { text, part } = await mountEditor()
    const length = history.length

    text.value = edited
    part('event-payload-editor-review').click()
    await vi.advanceTimersByTimeAsync(0)

    expect(history).toHaveLength(length + 1)
    expect(history.state).toEqual({ payloadStep: 'review' })
    expect(location.href).not.toContain('12345')
  })

  test('adds no history entry for an answer that is the editor again', async () => {
    fetchMock.mockResolvedValue(answer(brokenEditorPage))

    const { part } = await mountEditor()
    const length = history.length

    part('event-payload-editor-review').click()
    await vi.advanceTimersByTimeAsync(0)

    expect(history).toHaveLength(length)
    expect(history.state).toBeNull()
  })

  test('puts the editor back on Back, as the operator left it, and the review on Forward', async () => {
    fetchMock.mockResolvedValue(answer(reviewPage))

    const { text, part } = await mountEditor()
    const typed = `${edited}\n`

    text.value = typed
    part('event-payload-editor-review').click()
    await vi.advanceTimersByTimeAsync(0)
    const review = part('event-payload-review')

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    vi.advanceTimersToNextFrame()

    expect(part('event-payload-review')).toBeNull()
    expect(part<HTMLTextAreaElement>('event-payload-editor-text')).toBe(text)
    expect(text.value).toBe(typed)
    expect(document.activeElement).toBe(text)

    window.dispatchEvent(
      new PopStateEvent('popstate', { state: { payloadStep: 'review' } })
    )

    expect(part('event-payload-review')).toBe(review)
    expect(part('event-payload-editor')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('makes Back to editing go Back, once there is an editor behind the review', async () => {
    fetchMock.mockResolvedValue(answer(reviewPage))
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)

    const { part } = await mountEditor()

    part('event-payload-editor-review').click()
    await vi.advanceTimersByTimeAsync(0)
    part('event-edit-back').click()
    await vi.advanceTimersByTimeAsync(0)

    expect(back).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('leaves Confirm save to post and redirect as it always does', async () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined)

    const { part } = await mountPage(reviewPage)

    const form = part<HTMLFormElement>('event-edit-form')
    const event = new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter: part('event-edit-submit')
    })

    form.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  test.each([
    [
      'the fetch fails',
      () => fetchMock.mockRejectedValue(new Error('offline'))
    ],
    [
      'the server answers with an error',
      () => fetchMock.mockResolvedValue(answer('', false))
    ],
    [
      'the answer is not the editor, such as a conflict banner',
      () => fetchMock.mockResolvedValue(answer(conflictPage))
    ]
  ])('submits the form whole when %s', async (_name, given) => {
    given()

    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined)

    const { part } = await mountEditor()

    part('event-payload-editor-review').click()
    await vi.advanceTimersByTimeAsync(0)

    expect(submit).toHaveBeenCalledTimes(1)
    expect(part('event-payload-editor')).not.toBeNull()
  })

  test('submits Back to editing whole with its name, value and target when the fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined)

    const { part } = await mountPage(reviewPage)

    part('event-edit-back').click()
    await vi.advanceTimersByTimeAsync(0)

    const form = part<HTMLFormElement>('event-edit-form')

    expect(submit).toHaveBeenCalledTimes(1)
    expect(form.getAttribute('action')).toBe(`${page}/payload/review#payload`)
    expect(
      form.querySelector<HTMLInputElement>('input[type="hidden"][name="back"]')
        ?.value
    ).toBe('edit')
  })
})

describe('toOffset', () => {
  test('counts from one on each line, and each line break as one character', () => {
    expect(toOffset('ab\ncd\nef', 1, 1)).toBe(0)
    expect(toOffset('ab\ncd\nef', 2, 2)).toBe(4)
    expect(toOffset('ab\ncd\nef', 3, 3)).toBe(8)
  })

  test('stops at the end of the text', () => {
    expect(toOffset('ab', 9, 9)).toBe(2)
  })
})
