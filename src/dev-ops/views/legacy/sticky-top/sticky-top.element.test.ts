// @vitest-environment happy-dom

import { render } from '../../../test-utils.ts'
import { StickyTop } from './sticky-top.element.ts'

class FakeResizeObserver {
  static made: FakeResizeObserver[] = []
  observed: Element[] = []
  disconnected = false

  callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.made.push(this)
  }

  observe(element: Element) {
    this.observed.push(element)
  }

  disconnect() {
    this.disconnected = true
  }
}

const heights = new Map<string, number>()

const measured = function (this: HTMLElement) {
  return { height: heights.get(this.localName) ?? 0 } as DOMRect
}

const mountPage = async () => {
  await import('../index.ts')
  document.body.innerHTML = `<header class="navbar"></header>${render(
    'sticky-top',
    {},
    '<h1>Events</h1>'
  )('body').html()}`
  await Promise.resolve()

  return document.querySelector<StickyTop>('do-sticky-top')!
}

const property = (name: string) =>
  document.documentElement.style.getPropertyValue(name)

describe('do-sticky-top', () => {
  beforeEach(() => {
    FakeResizeObserver.made = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      measured
    )
    heights.set('header', 57).set('do-sticky-top', 184)
    document.documentElement.removeAttribute('style')
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('registers the custom element', async () => {
    await mountPage()

    expect(customElements.get('do-sticky-top')).toBe(StickyTop)
  })

  test('measures the block alone onto the root, as no bar sits above it where it sticks', async () => {
    await mountPage()

    expect(property('--sticky-top')).toBe('184px')
  })

  test('measures again when the block resizes', async () => {
    const block = await mountPage()
    const [observer] = FakeResizeObserver.made

    expect(observer.observed).toEqual([block])

    heights.set('do-sticky-top', 232)
    observer.callback([], observer as unknown as ResizeObserver)

    expect(property('--sticky-top')).toBe('232px')
  })

  test('stops watching once it leaves the page', async () => {
    const block = await mountPage()

    block.remove()

    expect(FakeResizeObserver.made[0].disconnected).toBe(true)
  })

  test("wraps the page's own top, sticky only where there is room", async () => {
    const block = await mountPage()

    expect(block.querySelector('h1')?.textContent).toBe('Events')
    expect(block.classList).toContain(
      '[@media(min-width:64rem)_and_(min-height:40rem)]:sticky'
    )
    expect(block.classList).toContain(
      '[@media(min-width:64rem)_and_(min-height:40rem)]:top-0'
    )
    expect(block.classList).not.toContain('sticky')
    expect(block.classList).toContain('bg-base-200')
  })
})
