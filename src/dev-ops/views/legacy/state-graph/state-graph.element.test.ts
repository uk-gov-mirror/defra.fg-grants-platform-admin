// @vitest-environment happy-dom
import { StateGraph } from './state-graph.element.ts'

const box = (scrollWidth: number, clientWidth: number, nodeX = 900) => {
  document.body.innerHTML = `<do-state-graph><p id="hint" hidden></p><div data-graph-scroll data-hint="hint"><svg><g data-band-label data-x="100" data-room="500"></g><a aria-current="true"><rect x="${nodeX}" width="100"></rect></a></svg></div></do-state-graph>`
  const scroller = document.querySelector<HTMLElement>('[data-graph-scroll]')!

  Object.defineProperty(scroller, 'scrollWidth', {
    value: scrollWidth,
    configurable: true
  })
  Object.defineProperty(scroller, 'clientWidth', {
    value: clientWidth,
    configurable: true
  })

  return scroller
}

const enhance = () =>
  document.querySelector<StateGraph>('do-state-graph')!.enhance()

describe('state-graph element', () => {
  beforeAll(() => {
    if (!customElements.get('do-state-graph')) {
      customElements.define('do-state-graph', StateGraph)
    }
  })

  test('scrolls a selected status out of view just into view', () => {
    const scroller = box(2000, 400)

    enhance()

    expect(scroller.scrollLeft).toBe(608)
  })

  test('leaves a selected status already in view where it is', () => {
    const scroller = box(2000, 400, 100)

    enhance()

    expect(scroller.scrollLeft).toBe(0)
  })

  test('shows the scroll hint and describes the box by it only while the graph is wider than its box', () => {
    const scroller = box(2000, 400)

    enhance()

    expect(document.getElementById('hint')!.hidden).toBe(false)
    expect(scroller.getAttribute('aria-describedby')).toBe('hint')

    const fits = box(400, 400, 100)

    enhance()

    expect(document.getElementById('hint')!.hidden).toBe(true)
    expect(fits.hasAttribute('aria-describedby')).toBe(false)
  })

  test('checks again when the box is resized', () => {
    const scroller = box(400, 400, 100)
    let resized: ResizeObserverCallback = () => {}

    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resized = callback
        }

        observe() {}

        disconnect() {}
      }
    )
    enhance()

    expect(document.getElementById('hint')!.hidden).toBe(true)

    Object.defineProperty(scroller, 'clientWidth', { value: 300 })
    resized(
      [{ target: scroller } as unknown as ResizeObserverEntry],
      {} as ResizeObserver
    )

    expect(document.getElementById('hint')!.hidden).toBe(false)
    vi.unstubAllGlobals()
  })

  test("keeps each stage's label at the box's left edge while its band is in view", () => {
    const scroller = box(2000, 400)

    enhance()

    expect(
      scroller.querySelector('[data-band-label]')!.getAttribute('transform')
    ).toBe('translate(500 0)')

    scroller.scrollLeft = 300
    scroller.dispatchEvent(new Event('scroll'))

    expect(
      scroller.querySelector('[data-band-label]')!.getAttribute('transform')
    ).toBe('translate(200 0)')
  })
})
