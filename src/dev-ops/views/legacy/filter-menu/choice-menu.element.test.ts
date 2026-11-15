// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'
import { ChoiceMenu } from './choice-menu.element.ts'

const params = {
  testId: 'bucket-search-kind',
  panelId: 'bucket-search-kind-panel',
  field: 'ref-kind',
  label: 'Search events by',
  items: [
    { value: 'ref', label: 'Reference', active: false },
    { value: 'msg', label: 'Message id', active: true },
    { value: 'trace', label: 'Trace ID', active: false }
  ]
}

const part = <T extends HTMLElement>(body: HTMLElement, name: string) =>
  body.querySelector<T>(`[data-testid="bucket-search-kind-${name}"]`)

const mountMenu = async () => {
  const body = await mount('filter-menu', params)
  const panel = part(body, 'panel')!

  const hidePopover = vi.fn<() => void>()

  Object.defineProperty(panel, 'hidePopover', { value: hidePopover })

  return {
    body,
    hidePopover,
    value: part<HTMLInputElement>(body, 'value')!,
    trigger: part<HTMLButtonElement>(body, 'button')!,
    chosen: part(body, 'chosen')!,
    options: [
      ...body.querySelectorAll<HTMLButtonElement>(
        '[data-testid="bucket-search-kind-chip"]'
      )
    ]
  }
}

const pressed = (options: HTMLButtonElement[]) =>
  options.map((option) => option.getAttribute('aria-pressed'))

describe('do-choice-menu', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('registers the custom element', async () => {
    await mountMenu()

    expect(customElements.get('do-choice-menu')).toBe(ChoiceMenu)
  })

  test('takes over from the select, with the choice it was rendered with', async () => {
    const { body, value, trigger, chosen } = await mountMenu()

    expect(part(body, 'select')).toBeNull()
    expect(value.disabled).toBe(false)
    expect(value.value).toBe('msg')
    expect(trigger.hidden).toBe(false)
    expect(chosen.textContent).toBe('Message id')
    expect(
      [...body.querySelectorAll('[name="ref-kind"]')].map(
        (field) => field.tagName
      )
    ).toEqual(['INPUT'])
  })

  test('puts a chosen option in the field and on the button', async () => {
    const { value, chosen, options } = await mountMenu()

    options[2].click()

    expect(value.value).toBe('trace')
    expect(chosen.textContent).toBe('Trace ID')
    expect(pressed(options)).toEqual(['false', 'false', 'true'])
    expect(options[2].classList.contains('font-semibold')).toBe(true)
    expect(options[1].classList.contains('font-semibold')).toBe(false)
    expect(
      options[2].querySelector('svg')!.classList.contains('invisible')
    ).toBe(false)
    expect(
      options[1].querySelector('svg')!.classList.contains('invisible')
    ).toBe(true)
  })

  test('closes the menu and hands focus back to the button', async () => {
    const { hidePopover, trigger, options } = await mountMenu()

    options[0].click()

    expect(hidePopover).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
  })

  test('submits nothing and goes nowhere on a choice', async () => {
    const { body, options } = await mountMenu()
    const form = document.createElement('form')
    const submitted = vi.fn((event: Event) => event.preventDefault())

    form.append(...body.childNodes)
    body.append(form)
    form.addEventListener('submit', submitted)

    options[0].click()

    expect(submitted).not.toHaveBeenCalled()
    expect(new FormData(form).getAll('ref-kind')).toEqual(['ref'])
  })

  test('leaves markup it does not recognise alone', async () => {
    document.body.innerHTML =
      '<do-choice-menu><select name="ref-kind"><option value="ref">Reference</option></select></do-choice-menu>'

    await Promise.resolve()

    expect(document.querySelector('select')!.name).toBe('ref-kind')
  })

  test('opens on the chosen option, and moves between options with the arrow keys', async () => {
    const { body, options } = await mountMenu()
    const panel = part(body, 'panel')!
    const toggle = new Event('toggle')

    Element.prototype.scrollIntoView = () => undefined
    Object.defineProperty(toggle, 'newState', { value: 'open' })
    panel.dispatchEvent(toggle)

    expect(document.activeElement).toBe(options[1])

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))

    expect(document.activeElement).toBe(options[2])
  })
})
