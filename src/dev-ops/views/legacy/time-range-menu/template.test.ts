import { render } from '../../../test-utils.ts'

const range = {
  label: 'Last 24h',
  title: 'Time range: Last 24h',
  active: true,
  presets: [
    {
      key: '15m',
      label: 'Last 15m',
      href: '/dev-ops/applications?from=A&range=15m',
      title: 'Applications created in the last 15m',
      active: false
    },
    {
      key: '24h',
      label: 'Last 24h',
      href: '/dev-ops/applications?from=B&range=24h',
      title: 'Applications created in the last 24h',
      active: true
    }
  ],
  anyTimeHref: '/dev-ops/applications?code=woodland',
  anyTimeActive: false,
  action: '/dev-ops/applications',
  hiddenFields: [{ name: 'code', value: 'woodland' }],
  fromInput: '2026-06-15T11:20:00',
  toInput: ''
}

const menu = (params: object = { id: 'applications', range }) =>
  render('time-range-menu', params)

describe('time-range-menu component', () => {
  test('names the window on the button, and marks it set', () => {
    const $ = menu()
    const $button = $('[data-testid="applications-range-button"]')

    expect($button.text().replace(/\s+/g, ' ').trim()).toBe('Time: Last 24h')
    expect($button.attr('title')).toBe('Time range: Last 24h')
    expect($button.attr('popovertarget')).toBe('applications-range-panel')
    expect($button.attr('class')).toContain(
      'shadow-[inset_0_-3px_0_var(--color-base-content)]'
    )
  })

  test('drops the set mark when there is no window', () => {
    const $ = menu({ id: 'applications', range: { ...range, active: false } })

    expect(
      $('[data-testid="applications-range-button"]').attr('class')
    ).not.toContain('font-semibold')
  })

  test('offers All, then the presets, ticking the current one', () => {
    const $ = menu()

    expect($('[data-testid="applications-range-any"]').attr('href')).toBe(
      '/dev-ops/applications?code=woodland'
    )
    expect(
      $('[data-testid="applications-range-preset"]')
        .map((_, preset) => $(preset).text().trim())
        .get()
    ).toEqual(['Last 15m', 'Last 24h'])
    expect($('[aria-current="true"]').attr('data-value')).toBe('24h')
  })

  test('posts the Custom boxes to the list with its other filters', () => {
    const $ = menu()
    const $form = $('[data-testid="applications-range-form"]')

    expect($form.attr('action')).toBe('/dev-ops/applications')
    expect($form.attr('method')).toBe('get')
    expect($('[data-testid="applications-range-filter"]').attr('name')).toBe(
      'code'
    )
    expect($('#applications-range-from').attr('value')).toBe(
      '2026-06-15T11:20:00'
    )
    expect($('#applications-range-from').attr('type')).toBe('datetime-local')
    expect($('label[for="applications-range-to"]').text()).toBe('To')
  })
})
