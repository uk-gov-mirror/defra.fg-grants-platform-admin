// @vitest-environment happy-dom

import { render } from '../../../test-utils.ts'
import { LoadMore, loadedMessage } from './load-more.element.ts'

class FakeObserver {
  static made: FakeObserver[] = []
  disconnected = false
  observed: Element[] = []
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    this.callback = callback
    this.options = options
    FakeObserver.made.push(this)
  }

  observe(element: Element) {
    this.observed.push(element)
  }

  disconnect() {
    this.disconnected = true
  }
}

const intersect = () => {
  const observer = FakeObserver.made.at(-1)!

  observer.callback(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    observer as unknown as IntersectionObserver
  )
}

const eventsParams = {
  id: 'events',
  rowLink: '[data-testid="event-link"]',
  outage: '[data-testid="events-error"], [data-testid="events-refused"]',
  partial: '[data-testid="events-partial"] span',
  nounMany: 'events',
  nounOne: 'event'
}

const pageOf = (ids: string[], next: string | null, extra: object = {}) =>
  `<table><tbody id="events-rows">${ids
    .map((id) => `<tr data-testid="event-row"><td>${id}</td></tr>`)
    .join('')}</tbody></table>${render('load-more', {
    ...eventsParams,
    ...extra,
    nextHref: next
  })('body').html()}`

const outagePage = `<div data-testid="events-card"><div role="alert" data-testid="events-error"><span>Events could not be loaded from GAS.</span></div></div>`
const refusedPage = `<div data-testid="events-card"><div role="alert" data-testid="events-refused"><span>GAS refused this link's parameters.</span></div></div>`
const emptyPage = `<div data-testid="events-card"><p data-testid="events-empty">No events found.</p></div>`
const partialPage = (ids: string[], next: string | null) =>
  `<div role="alert" data-testid="events-partial"><span>Some event sources are unavailable: CW-BE Inbox. Showing the rest.</span></div>${pageOf(ids, next)}`

const answer = (html: string, ok = true) => ({
  ok,
  status: ok ? 200 : 502,
  text: async () => html
})

const fetchMock = vi.fn()

const mountList = async (next: string | null = '/dev-ops/events?cursor=A') => {
  await import('../index.ts')
  document.body.innerHTML = pageOf(['1'], next)
  await vi.advanceTimersByTimeAsync(0)

  const body = document.body
  const part = (testId: string) =>
    body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!

  return {
    rows: () =>
      [...body.querySelectorAll('#events-rows > tr')].map((row) =>
        row.textContent?.trim()
      ),
    table: body.querySelector('table')!,
    sentinel: part('events-load-more-sentinel'),
    spinner: part('events-load-more-spinner'),
    end: part('events-load-more-end'),
    error: part('events-load-more-error'),
    retry: part('events-load-more-retry') as HTMLButtonElement,
    status: part('events-load-more-status')
  }
}

const farAway = (sentinel: HTMLElement) => {
  sentinel.getBoundingClientRect = () => ({ top: 100_000 }) as DOMRect
}

describe('do-load-more', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame']
    })
    FakeObserver.made = []
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('registers the custom element', async () => {
    await mountList()

    expect(customElements.get('do-load-more')).toBe(LoadMore)
  })

  test('watches the sentinel with a margin below the viewport', async () => {
    const { sentinel } = await mountList()

    const [observer] = FakeObserver.made

    expect(observer.observed).toEqual([sentinel])
    expect(observer.options?.rootMargin).toBe('0px 0px 600px 0px')
  })

  test('fetches the next page, appends its rows, and takes its next page', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(
      answer(pageOf(['2', '3'], '/dev-ops/events?cursor=B'))
    )
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledWith(
      '/dev-ops/events?cursor=A',
      expect.objectContaining({ credentials: 'same-origin' })
    )
    expect(list.rows()).toEqual(['1', '2', '3'])

    fetchMock.mockResolvedValueOnce(answer(pageOf(['4'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/dev-ops/events?cursor=B',
      expect.anything()
    )
    expect(list.rows()).toEqual(['1', '2', '3', '4'])
  })

  test('appends the rows whole, as the server drew them', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(answer(pageOf(['2'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(
      document.querySelectorAll('#events-rows > [data-testid="event-row"]')
    ).toHaveLength(2)
  })

  test('never fetches twice at once', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    let settle: (value: unknown) => void = () => undefined
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve
      })
    )
    intersect()
    intersect()
    intersect()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(list.spinner.hidden).toBe(false)
    expect(list.table.getAttribute('aria-busy')).toBe('true')

    settle(answer(pageOf(['2'], null)))
    await vi.advanceTimersByTimeAsync(0)

    expect(list.spinner.hidden).toBe(true)
    expect(list.table.getAttribute('aria-busy')).toBe('false')
  })

  test('stops at the end, and says so', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(answer(pageOf(['2'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(list.end.hidden).toBe(false)
    expect(list.end.textContent).toBe('No more events')
    expect(FakeObserver.made[0].disconnected).toBe(true)

    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('takes the tail of the last page loaded in place of the one drawn, and does not call a list that can go on over', async () => {
    await import('../index.ts')
    document.body.innerHTML = `${pageOf(['1'], '/dev-ops/buckets/x?cursor=A', { tail: 'list-tail' })}<p id="list-tail" hidden></p>`
    await vi.advanceTimersByTimeAsync(0)

    const end = document.querySelector<HTMLElement>(
      '[data-testid="events-load-more-end"]'
    )!

    farAway(
      document.querySelector<HTMLElement>(
        '[data-testid="events-load-more-sentinel"]'
      )!
    )
    fetchMock.mockResolvedValueOnce(
      answer(
        `${pageOf(['2'], null, { tail: 'list-tail', open: true })}<p id="list-tail">Searched back to 3 Sep. <a href="/dev-ops/buckets/x?cursor=B">Keep looking</a></p>`
      )
    )
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    const tail = document.getElementById('list-tail')!

    expect(tail.hidden).toBe(false)
    expect(tail.querySelector('a')?.getAttribute('href')).toBe(
      '/dev-ops/buckets/x?cursor=B'
    )
    expect(document.querySelectorAll('#list-tail')).toHaveLength(1)
    expect(end.hidden).toBe(true)
    expect(FakeObserver.made[0].disconnected).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('says no more of its own when the last page loaded ends with a tail that says it searched everything', async () => {
    await import('../index.ts')
    document.body.innerHTML = `${pageOf(['1'], '/dev-ops/buckets/x?cursor=A', { tail: 'list-tail' })}<p id="list-tail" hidden></p>`
    await vi.advanceTimersByTimeAsync(0)

    fetchMock.mockResolvedValueOnce(
      answer(
        `${pageOf(['2'], null, { tail: 'list-tail', closed: true })}<p id="list-tail" data-closed>Searched everything.</p>`
      )
    )
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(document.getElementById('list-tail')?.textContent).toBe(
      'Searched everything.'
    )
    expect(
      document.querySelector<HTMLElement>(
        '[data-testid="events-load-more-end"]'
      )?.hidden
    ).toBe(true)
    expect(FakeObserver.made[0].disconnected).toBe(true)
  })

  test('shows the tail an empty last page kept hidden, and says no more of its own, when that page searched everything', async () => {
    await import('../index.ts')
    document.body.innerHTML = `${pageOf(['1'], '/dev-ops/buckets/x?cursor=A', { tail: 'list-tail' })}<p id="list-tail" hidden></p>`
    await vi.advanceTimersByTimeAsync(0)

    fetchMock.mockResolvedValueOnce(
      answer(
        `<div data-testid="events-card"><p data-testid="events-empty">No events found. Searched everything.</p></div><p id="list-tail" hidden data-closed>Searched everything.</p>`
      )
    )
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    const tail = document.getElementById('list-tail')!

    expect(tail.hidden).toBe(false)
    expect(tail.textContent).toBe('Searched everything.')
    expect(
      document.querySelector<HTMLElement>(
        '[data-testid="events-load-more-end"]'
      )?.hidden
    ).toBe(true)
  })

  test('does not call a list over when its last page found no rows but can go on', async () => {
    await import('../index.ts')
    document.body.innerHTML = `${pageOf(['1'], '/dev-ops/buckets/x?cursor=A', { tail: 'list-tail' })}<p id="list-tail" hidden></p>`
    await vi.advanceTimersByTimeAsync(0)

    fetchMock.mockResolvedValueOnce(
      answer(
        `${emptyPage}<p id="list-tail" data-open>Searched back to 3 Sep. <a href="/dev-ops/buckets/x?cursor=B">Keep looking</a></p>`
      )
    )
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(document.querySelector('#list-tail a')?.getAttribute('href')).toBe(
      '/dev-ops/buckets/x?cursor=B'
    )
    expect(
      document.querySelector<HTMLElement>(
        '[data-testid="events-load-more-end"]'
      )?.hidden
    ).toBe(true)
  })

  test('adds nothing from a page it was redirected to', async () => {
    const list = await mountList()

    fetchMock.mockResolvedValueOnce({
      ...answer(pageOf(['9'], null)),
      redirected: true
    })
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(list.rows()).toEqual(['1'])
    expect(list.error.hidden).toBe(false)
  })

  test('says the list is over when its last page has a tail but no way on', async () => {
    await import('../index.ts')
    document.body.innerHTML = `${pageOf(['1'], '/dev-ops/buckets/x?cursor=A', { tail: 'list-tail' })}<p id="list-tail" hidden></p>`
    await vi.advanceTimersByTimeAsync(0)

    fetchMock.mockResolvedValueOnce(
      answer(
        `${pageOf(['2'], null, { tail: 'list-tail' })}<p id="list-tail">Searched everything.</p>`
      )
    )
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(document.getElementById('list-tail')?.textContent).toBe(
      'Searched everything.'
    )
    expect(
      document.querySelector<HTMLElement>(
        '[data-testid="events-load-more-end"]'
      )?.hidden
    ).toBe(false)
  })

  test('watches nothing on a page that is already the last', async () => {
    const list = await mountList(null)

    expect(FakeObserver.made).toHaveLength(0)
    expect(list.end.hidden).toBe(false)
  })

  test('stops on a failure and offers Retry, which loads again', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(answer('', false))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(list.error.hidden).toBe(false)
    expect(list.error.textContent).toBe('More events could not be loaded.')
    expect(list.error.getAttribute('role')).toBe('alert')
    expect(list.retry.hidden).toBe(false)
    expect(list.spinner.hidden).toBe(true)
    expect(list.rows()).toEqual(['1'])

    intersect()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce(answer(pageOf(['2'], null)))
    list.retry.click()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(list.rows()).toEqual(['1', '2'])
    expect(list.error.hidden).toBe(true)
    expect(list.retry.hidden).toBe(true)
  })

  test.each([
    ['an outage page', outagePage],
    ['a refused page', refusedPage],
    ['a page it does not recognise', '<p>Something else</p>']
  ])(
    'fails, and offers Retry, on %s answered with a 200',
    async (_name, html) => {
      const list = await mountList()

      farAway(list.sentinel)
      fetchMock.mockResolvedValueOnce(answer(html))
      intersect()
      await vi.advanceTimersByTimeAsync(2000)

      expect(list.error.hidden).toBe(false)
      expect(list.retry.hidden).toBe(false)
      expect(list.end.hidden).toBe(true)
      expect(FakeObserver.made[0].disconnected).toBe(false)
      expect(list.rows()).toEqual(['1'])
      expect(list.status.textContent).toBe('')
    }
  )

  test('ends on a genuine empty page, and says so', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(answer(emptyPage))
    intersect()
    await vi.advanceTimersByTimeAsync(2000)

    expect(list.end.hidden).toBe(false)
    expect(list.error.hidden).toBe(true)
    expect(list.status.textContent).toBe('No more events')
  })

  const linkedPage = (ids: string[], next: string | null, partial: boolean) =>
    `${partial ? '<div role="alert" data-testid="events-partial"><span>Some event sources are unavailable: CW-BE Inbox. Showing the rest.</span></div>' : ''}<table><tbody id="events-rows">${ids
      .map(
        (id) =>
          `<tr data-testid="event-row"><td><a data-testid="event-link" href="/dev-ops/events/gas/inbox/${id}">${id}</a></td></tr>`
      )
      .join('')}</tbody></table>${render('load-more', {
      ...eventsParams,
      nextHref: next
    })('body').html()}`

  test('offers Retry on a partial last page, and appends only what it had not shown', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(answer(linkedPage(['2'], null, true)))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(list.end.hidden).toBe(true)
    expect(list.retry.hidden).toBe(false)

    fetchMock.mockResolvedValueOnce(
      answer(linkedPage(['2', '3'], '/dev-ops/events?cursor=C', false))
    )
    list.retry.click()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/dev-ops/events?cursor=A',
      expect.anything()
    )
    expect(list.rows()).toEqual(['1', '2', '3'])
    expect(list.retry.hidden).toBe(true)
    expect(FakeObserver.made.at(-1)?.observed).toEqual([list.sentinel])
  })

  test('appends a partial page and says which sources are missing', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(
      answer(partialPage(['2'], '/dev-ops/events?cursor=B'))
    )
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    const partial = document.querySelector<HTMLElement>(
      '[data-testid="events-load-more-partial"]'
    )!

    expect(list.rows()).toEqual(['1', '2'])
    expect(partial.hidden).toBe(false)
    expect(partial.textContent).toBe(
      'Some event sources are unavailable: CW-BE Inbox. Showing the rest.'
    )

    await vi.advanceTimersByTimeAsync(1600)

    expect(list.status.textContent).toBe(
      '1 more event loaded. Some event sources are unavailable: CW-BE Inbox. Showing the rest.'
    )
  })

  test('treats a network failure as a failure too', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(list.retry.hidden).toBe(false)
  })

  test('announces the arrivals in one polite sentence', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock
      .mockResolvedValueOnce(
        answer(pageOf(['2', '3'], '/dev-ops/events?cursor=B'))
      )
      .mockResolvedValueOnce(answer(pageOf(['4'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(0)
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(list.status.textContent).toBe('')

    await vi.advanceTimersByTimeAsync(1600)

    expect(list.status.getAttribute('aria-live')).toBe('polite')
    expect(list.status.textContent).toBe('3 more events loaded. No more events')
  })

  test('keeps loading while the sentinel is still in reach', async () => {
    const list = await mountList()

    list.sentinel.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    fetchMock
      .mockResolvedValueOnce(answer(pageOf(['2'], '/dev-ops/events?cursor=B')))
      .mockResolvedValueOnce(answer(pageOf(['3'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(100)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(list.rows()).toEqual(['1', '2', '3'])
    expect(list.end.hidden).toBe(false)
  })

  test('moves no focus', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    const before = document.activeElement
    fetchMock.mockResolvedValueOnce(answer(pageOf(['2'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(document.activeElement).toBe(before)
  })

  test('takes the More link away once it is watching', async () => {
    await mountList()

    expect(
      document.querySelector<HTMLElement>(
        '[data-testid="events-load-more-link"]'
      )?.hidden
    ).toBe(true)
  })

  // Scripting is on, so `noscript` never renders: without this the list is
  // silently truncated at one page, with no control and no "No more events".
  test('keeps the More link when it cannot watch the sentinel', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor() {
          throw new Error('unsupported')
        }
      }
    )
    await import('../index.ts')
    document.body.innerHTML = pageOf(['1'], '/dev-ops/events?cursor=A')
    await vi.advanceTimersByTimeAsync(0)

    expect(
      document.querySelector<HTMLElement>(
        '[data-testid="events-load-more-link"]'
      )?.hidden
    ).toBe(false)
  })

  test('does not start without the noun it announces rows by', async () => {
    await import('../index.ts')
    document.body.innerHTML = pageOf(['1'], '/dev-ops/events?cursor=A').replace(
      ' data-noun-many="events"',
      ''
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(FakeObserver.made).toHaveLength(0)
    expect(
      document.querySelector<HTMLElement>(
        '[data-testid="events-load-more-link"]'
      )?.hidden
    ).toBe(false)
  })

  test('reads its rows and its empty page off its id unless told otherwise', () => {
    const $ = render('load-more', { ...eventsParams, nextHref: null })
    const element = $('do-load-more')

    expect(element.attr('data-rows')).toBe('events-rows')
    expect(element.attr('data-page-empty')).toBe('[data-testid="events-empty"]')
  })

  test('leaves markup it does not recognise alone', async () => {
    await import('../index.ts')
    document.body.innerHTML =
      '<do-load-more data-next-page="/x"><p>Nothing here</p></do-load-more>'
    await vi.advanceTimersByTimeAsync(0)

    expect(FakeObserver.made).toHaveLength(0)
  })
})

describe('do-load-more on another list', () => {
  const applicationsParams = {
    id: 'applications',
    rows: 'applications-rows applications-list',
    rowLink: '[data-testid="application-link"]',
    nounMany: 'applications',
    nounOne: 'application'
  }

  const applicationsPage = (ids: string[], next: string | null) =>
    `<table><tbody id="applications-rows">${ids
      .map(
        (id) =>
          `<tr><td><a data-testid="application-link" href="/dev-ops/applications/frps/${id}">${id}</a></td></tr>`
      )
      .join('')}</tbody></table><ul id="applications-list">${ids
      .map(
        (id) =>
          `<li><a data-testid="application-link" href="/dev-ops/applications/frps/${id}">${id}</a></li>`
      )
      .join('')}</ul>${render('load-more', {
      ...applicationsParams,
      nextHref: next
    })('body').html()}`

  const textOf = (selector: string) =>
    [...document.querySelectorAll(selector)].map((row) =>
      row.textContent?.trim()
    )

  const part = (testId: string) =>
    document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame']
    })
    FakeObserver.made = []
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const mountApplications = async () => {
    await import('../index.ts')
    document.body.innerHTML = applicationsPage(
      ['a1'],
      '/dev-ops/applications?cursor=A'
    )
    await vi.advanceTimersByTimeAsync(0)
    farAway(part('applications-load-more-sentinel'))
  }

  test('appends the next page to the table and the phone list alike', async () => {
    await mountApplications()
    fetchMock.mockResolvedValueOnce(
      answer(applicationsPage(['a2', 'a3'], null))
    )
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(textOf('#applications-rows > tr')).toEqual(['a1', 'a2', 'a3'])
    expect(textOf('#applications-list > li')).toEqual(['a1', 'a2', 'a3'])
  })

  test('says what it loaded, and that there is no more, in its own noun', async () => {
    await mountApplications()
    fetchMock.mockResolvedValueOnce(
      answer(
        applicationsPage(
          Array.from({ length: 20 }, (_, index) => `b${index}`),
          null
        )
      )
    )
    intersect()
    await vi.advanceTimersByTimeAsync(1600)

    expect(part('applications-load-more-end').textContent).toBe(
      'No more applications'
    )
    expect(part('applications-load-more-status').textContent).toBe(
      '20 more applications loaded. No more applications'
    )
  })

  test('ends on its own empty page', async () => {
    await mountApplications()
    fetchMock.mockResolvedValueOnce(
      answer('<p data-testid="applications-empty">No applications found.</p>')
    )
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(part('applications-load-more-end').hidden).toBe(false)
    expect(part('applications-load-more-error').hidden).toBe(true)
  })

  test('fails in its own noun on a page it does not recognise', async () => {
    await mountApplications()
    fetchMock.mockResolvedValueOnce(answer('<p>Something else</p>'))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(part('applications-load-more-error').textContent).toBe(
      'More applications could not be loaded.'
    )
  })

  test('keeps the More link for no script, naming its rows', () => {
    const $ = render('load-more', {
      ...applicationsParams,
      nextHref: '/dev-ops/applications?cursor=A'
    })

    expect($('[data-testid="applications-load-more-link"]').text()).toBe(
      'More applications'
    )
  })
})

describe('loadedMessage', () => {
  test('counts what arrived, in the singular for one', () => {
    const noun = { one: 'event', many: 'events' }

    expect(loadedMessage(20, noun)).toBe('20 more events loaded')
    expect(loadedMessage(1, noun)).toBe('1 more event loaded')
  })

  test('names the rows of whichever list it serves', () => {
    expect(
      loadedMessage(20, { one: 'application', many: 'applications' })
    ).toBe('20 more applications loaded')
  })
})
