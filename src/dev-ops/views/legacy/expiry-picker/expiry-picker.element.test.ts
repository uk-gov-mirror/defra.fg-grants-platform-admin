// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'
import { ExpiryPicker } from './expiry-picker.element.ts'

const picker = {
  id: 'p',
  choices: [
    { value: 'never', label: 'Never', checked: false },
    { value: '30', label: '30 days', checked: true },
    { value: 'custom', label: 'Custom date', checked: false }
  ],
  date: '',
  min: '2026-11-04',
  summary: '',
  error: null as string | null
}

const mountPicker = async (overrides: Partial<typeof picker> = {}) => {
  const body = await mount('expiry-picker', {
    picker: { ...picker, ...overrides }
  })
  const get = <T extends HTMLElement>(testId: string) =>
    body.querySelector<T>(`[data-testid="${testId}"]`)!

  return {
    choose: (value: string) => {
      const radio = get<HTMLInputElement>(`p-${value}`)

      radio.checked = true
      radio.dispatchEvent(new Event('change', { bubbles: true }))
    },
    setDate: (value: string) => {
      const date = get<HTMLInputElement>('p-date')

      date.value = value
      date.dispatchEvent(new Event('input', { bubbles: true }))
    },
    summary: () => get('p-summary').textContent,
    picker: () => body.querySelector<HTMLElement>('do-expiry-picker')!,
    get
  }
}

const sentInThePast = {
  choices: [
    { value: 'never', label: 'Never', checked: false },
    { value: '30', label: '30 days', checked: false },
    { value: 'custom', label: 'Custom date', checked: true }
  ],
  date: '2020-01-01',
  summary: 'Pick a date in the future.',
  error: 'Pick a date in the future.'
}

describe('do-expiry-picker', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: new Date('2026-11-04T13:50:00.000Z'),
      toFake: ['Date']
    })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('registers the custom element', async () => {
    await mountPicker()

    expect(customElements.get('do-expiry-picker')).toBe(ExpiryPicker)
  })

  test('says what a preset comes to', async () => {
    const { choose, summary } = await mountPicker()

    choose('never')
    expect(summary()).toBe('Never expires.')

    choose('30')
    expect(summary()).toBe('Expires 4 Dec 2026.')
  })

  test('keeps the exact current expiry while its day is left alone', async () => {
    const { choose, setDate, summary, picker } = await mountPicker()

    picker().dataset.current = '2027-01-31T10:00:00.000Z'
    choose('custom')
    setDate('2027-01-31')

    expect(summary()).toBe('Expires 31 Jan 2027.')
  })

  test('says what a custom date comes to, and asks for one until it is a date', async () => {
    const { choose, setDate, summary, picker } = await mountPicker()

    choose('custom')
    expect(summary()).toBe('Pick a date.')
    expect(picker().hasAttribute('data-invalid')).toBe(true)

    setDate('2027-01-31')
    expect(summary()).toBe('Expires 31 Jan 2027.')
    expect(picker().hasAttribute('data-invalid')).toBe(false)
  })

  test("keeps the server's error until the expiry is changed", async () => {
    const { get } = await mountPicker(sentInThePast)

    expect(get('p-error')).not.toBeNull()
    expect(get('p-date').getAttribute('aria-invalid')).toBe('true')
  })

  test("drops the server's error, and what points at it, once the expiry is changed", async () => {
    const { setDate, summary, picker, get } = await mountPicker(sentInThePast)

    setDate('2027-01-31')

    expect(get('p-error')).toBeNull()
    expect(get('p-date').hasAttribute('aria-invalid')).toBe(false)
    expect(get('p-date').hasAttribute('aria-describedby')).toBe(false)
    expect(
      picker().querySelector('fieldset')!.getAttribute('aria-describedby')
    ).toBe('p-summary')
    expect(summary()).toBe('Expires 31 Jan 2027.')
  })
})
