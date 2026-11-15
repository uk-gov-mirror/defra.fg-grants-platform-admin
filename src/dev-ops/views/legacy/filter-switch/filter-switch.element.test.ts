// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'
import { FilterSwitch } from './filter-switch.element.ts'

const off = {
  testId: 'bucket-toggle-kind',
  checked: false,
  href: '/dev-ops/events/gas/outbox?audit=on',
  label: 'Show audit events'
}

const mountSwitch = async (overrides: object = {}) => {
  const body = await mount('filter-switch', { ...off, ...overrides })

  return {
    link: body.querySelector<HTMLAnchorElement>(
      '[data-testid="bucket-toggle-kind"]'
    )!,
    toggle: body.querySelector<HTMLElement>(
      '[data-testid="bucket-toggle-kind-knob"]'
    )!,
    state: body.querySelector<HTMLElement>(
      '[data-testid="bucket-toggle-kind-state"]'
    )!
  }
}

const click = (link: HTMLAnchorElement, init: MouseEventInit = {}) => {
  let prevented = false
  const stop = (event: Event) => {
    prevented = event.defaultPrevented
    event.preventDefault()
  }

  link.addEventListener('click', stop, { once: true })
  link.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  )

  return { preventedBySwitch: prevented }
}

describe('do-filter-switch', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('registers the custom element', async () => {
    await mountSwitch()

    expect(customElements.get('do-filter-switch')).toBe(FilterSwitch)
  })

  test('flips the switch on an ordinary click', async () => {
    const { link, toggle, state } = await mountSwitch()

    click(link)

    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(state.textContent).toBe(', on')
  })

  test('flips an on switch off', async () => {
    const { link, toggle, state } = await mountSwitch({
      checked: true,
      href: '/dev-ops/events/gas/outbox'
    })

    click(link)

    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(state.textContent).toBe(', off')
  })

  test('leaves the navigation to the link', async () => {
    const { link } = await mountSwitch()

    expect(click(link).preventedBySwitch).toBe(false)
    expect(link.getAttribute('href')).toBe(
      '/dev-ops/events/gas/outbox?audit=on'
    )
  })

  test.each([
    ['a ctrl click', { ctrlKey: true }],
    ['a cmd click', { metaKey: true }],
    ['a shift click', { shiftKey: true }],
    ['an alt click', { altKey: true }],
    ['a middle click', { button: 1 }]
  ])('ignores %s', async (_name, init) => {
    const { link, toggle, state } = await mountSwitch()

    click(link, init)

    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(state.textContent).toBe(', off')
  })

  test('leaves markup it does not recognise alone', async () => {
    document.body.innerHTML =
      '<do-filter-switch data-checked="false"><a href="/x">Nothing here</a></do-filter-switch>'

    await Promise.resolve()

    document
      .querySelector('a')!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      )

    expect(document.querySelector('a')!.textContent).toBe('Nothing here')
  })
})

// `data-checked` is the rendered state, for restoring after a bfcache return.
describe('do-filter-switch after a back-navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  const pageshow = (persisted: boolean) => {
    const event = new Event('pageshow')

    Object.defineProperty(event, 'persisted', { value: persisted })
    window.dispatchEvent(event)
  }

  test('puts a flipped switch back to the state it was rendered in', async () => {
    const { link, toggle, state } = await mountSwitch()

    click(link)
    pageshow(true)

    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(state.textContent).toBe(', off')
  })

  test('restores an on page to on, not to the default', async () => {
    const { link, toggle } = await mountSwitch({
      checked: true,
      href: '/dev-ops/events/gas/outbox'
    })

    click(link)
    pageshow(true)

    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  test('leaves a page that was not restored alone', async () => {
    const { link, toggle } = await mountSwitch()

    click(link)
    pageshow(false)

    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
})
