// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'

const listPath = '/dev-ops/events'
const eventPath = '/dev-ops/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b'

/** Only `referrer` and `history.length` tell the arrivals apart, so each case
 *  sets both, and has to set them before the element mounts and reads them. */
const arriveWith = async ({
  referrer,
  entries = 2
}: {
  referrer: string
  entries?: number
}) => {
  Object.defineProperty(document, 'referrer', {
    value: referrer,
    configurable: true
  })
  Object.defineProperty(history, 'length', {
    value: entries,
    configurable: true
  })

  const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)
  const body = await mount('back', { href: `${listPath}?status=DEAD_LETTER` })

  const link = body.querySelector<HTMLAnchorElement>(
    '[data-testid="event-back"]'
  )!

  const click = (init: MouseEventInit = {}) => {
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init
    })
    link.dispatchEvent(event)

    return event
  }

  return { back, click, link }
}

const origin = location.origin

// The config clears mocks between tests but does not restore them, and two of
// the three stubs above are not mocks at all, so none of it is undone for us.
afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'referrer')
  Reflect.deleteProperty(history, 'length')
})

describe('do-back', () => {
  test('goes back in history when the list is the page behind it', async () => {
    const { back, click } = await arriveWith({
      referrer: `${origin}${listPath}?status=DEAD_LETTER`
    })

    expect(click().defaultPrevented).toBe(true)
    expect(back).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['a pasted link, with no referrer at all', { referrer: '' }],
    [
      'a new tab, whose history has nowhere to go back to',
      { referrer: `${origin}${listPath}`, entries: 1 }
    ],
    [
      'a redrive, which answers back to this same event',
      { referrer: `${origin}${eventPath}` }
    ],
    ['another site', { referrer: `https://example.com${listPath}` }],
    ['another page of this app', { referrer: `${origin}/dev-ops` }],
    ['a referrer that is not a url at all', { referrer: 'not a url' }]
  ])('follows the href after %s', async (_case, arrival) => {
    const { back, click } = await arriveWith(arrival)

    expect(click().defaultPrevented).toBe(false)
    expect(back).not.toHaveBeenCalled()
  })

  test.each([
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
    ['shiftKey', { shiftKey: true }],
    ['altKey', { altKey: true }],
    ['middle', { button: 1 }]
  ])('leaves a %s click to the browser', async (_name, init) => {
    const { back, click } = await arriveWith({
      referrer: `${origin}${listPath}`
    })

    expect(click(init).defaultPrevented).toBe(false)
    expect(back).not.toHaveBeenCalled()
  })
})
