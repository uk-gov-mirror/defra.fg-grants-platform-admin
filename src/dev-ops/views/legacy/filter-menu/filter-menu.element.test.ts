// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'
import { FilterMenu } from './filter-menu.element.ts'

const items = Array.from({ length: 40 }, (_, index) => ({
  label: `1.${index}.0`,
  href: `/dev-ops/grants/woodland/1.${index}.0`,
  active: index === 20
}))

const mountMenu = async () => {
  const body = await mount('filter-menu', {
    name: 'Version',
    label: 'Versions of woodland',
    small: true,
    testId: 'switcher',
    panelId: 'switcher-panel',
    items
  })
  const panel = body.querySelector<HTMLElement>('[popover]')!
  const links = [...panel.querySelectorAll<HTMLAnchorElement>('a')]

  return { panel, links }
}

const open = (panel: HTMLElement) => {
  const event = new Event('toggle')

  Object.defineProperty(event, 'newState', { value: 'open' })
  panel.dispatchEvent(event)
}

const press = (panel: HTMLElement, key: string) => {
  const event = new KeyboardEvent('keydown', { key, cancelable: true })

  panel.dispatchEvent(event)

  return event
}

describe('do-filter-menu', () => {
  const scrolled = vi.fn<(options?: ScrollIntoViewOptions) => void>()

  beforeEach(() => {
    document.body.innerHTML = ''
    scrolled.mockClear()
    Element.prototype.scrollIntoView = scrolled
  })

  test('registers the custom element', async () => {
    await mountMenu()

    expect(customElements.get('do-filter-menu')).toBe(FilterMenu)
  })

  test('puts the focus on the ticked item when it opens, scrolled into view', async () => {
    const { panel, links } = await mountMenu()

    open(panel)

    expect(document.activeElement).toBe(links[20])
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
  })

  test('moves the focus with the arrow keys, Home and End', async () => {
    const { panel, links } = await mountMenu()

    open(panel)
    expect(press(panel, 'ArrowDown').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(links[21])

    press(panel, 'ArrowUp')
    press(panel, 'ArrowUp')
    expect(document.activeElement).toBe(links[19])

    press(panel, 'End')
    expect(document.activeElement).toBe(links[39])
    press(panel, 'ArrowDown')
    expect(document.activeElement).toBe(links[39])

    press(panel, 'Home')
    expect(document.activeElement).toBe(links[0])
    press(panel, 'ArrowUp')
    expect(document.activeElement).toBe(links[0])
  })

  test('closes on Tab and lets the focus move on, its items out of the tab order', async () => {
    const { panel, links } = await mountMenu()
    const hidePopover = vi.fn<() => void>()

    Object.defineProperty(panel, 'hidePopover', { value: hidePopover })

    const tab = press(panel, 'Tab')

    expect(hidePopover).toHaveBeenCalledTimes(1)
    expect(tab.defaultPrevented).toBe(false)
    expect(links.every((link) => link.getAttribute('tabindex') === '-1')).toBe(
      true
    )
  })

  test('leaves every other key alone', async () => {
    const { panel } = await mountMenu()

    expect(press(panel, 'Escape').defaultPrevented).toBe(false)
  })

  test('caps the panel and scrolls it, under its trigger', async () => {
    const { panel } = await mountMenu()

    expect(panel.className).toContain('max-h-[min(28rem,70vh)]')
    expect(panel.className).toContain('overflow-y-auto')
    expect(panel.className).toContain('[position-try-fallbacks:none]')
  })
})
