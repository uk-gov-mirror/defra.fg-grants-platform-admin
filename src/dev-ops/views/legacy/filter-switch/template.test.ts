import { render } from '../../../test-utils.ts'

const off = {
  testId: 'bucket-toggle-kind',
  checked: false,
  href: '/dev-ops/events/gas/outbox?status=DEAD_LETTER&audit=on',
  label: 'Show audit events'
}

const on = {
  ...off,
  checked: true,
  href: '/dev-ops/events/gas/outbox?status=DEAD_LETTER'
}

describe('filter-switch component', () => {
  test('is one link to the url it was given', () => {
    const $switch = render('filter-switch', off)

    const link = $switch('[data-testid="bucket-toggle-kind"]')

    expect(link.is('a')).toBe(true)
    expect(link.attr('href')).toBe(off.href)
  })

  test('draws the switch as a hidden span, not an input', () => {
    const $switch = render('filter-switch', off)

    const toggle = $switch('[data-testid="bucket-toggle-kind-knob"]')

    expect(toggle.is('span')).toBe(true)
    expect(toggle.attr('class')).toBe('toggle')
    expect(toggle.attr('aria-hidden')).toBe('true')
    expect($switch('input, button')).toHaveLength(0)
  })

  test('names the link with its state, off', () => {
    const $switch = render('filter-switch', off)

    expect(
      $switch('[data-testid="bucket-toggle-kind"]')
        .text()
        .replace(/\s+/g, ' ')
        .trim()
    ).toBe('Show audit events, off')
    expect(
      $switch('[data-testid="bucket-toggle-kind-knob"]').attr('aria-checked')
    ).toBe('false')
    expect(
      $switch('[data-testid="bucket-toggle-kind-state"]').attr('class')
    ).toBe('sr-only')
  })

  test('names the link with its state, on', () => {
    const $switch = render('filter-switch', on)

    expect($switch('[data-testid="bucket-toggle-kind-state"]').text()).toBe(
      ', on'
    )
    expect(
      $switch('[data-testid="bucket-toggle-kind-knob"]').attr('aria-checked')
    ).toBe('true')
  })

  // `data-checked` is the rendered state, for restoring after a bfcache return.
  test('keeps the rendered state on the element', () => {
    expect(
      render('filter-switch', off)('do-filter-switch').attr('data-checked')
    ).toBe('false')
    expect(
      render('filter-switch', on)('do-filter-switch').attr('data-checked')
    ).toBe('true')
  })

  test("is a plain link at a md trigger's height, with the triggers' focus ring", () => {
    const link = render(
      'filter-switch',
      off
    )('[data-testid="bucket-toggle-kind"]')

    expect(link.hasClass('btn')).toBe(false)
    expect(link.hasClass('h-10')).toBe(true)
    expect(link.hasClass('cursor-pointer')).toBe(true)
    expect(link.hasClass('focus-visible:outline-2')).toBe(true)
    expect(link.hasClass('focus-visible:outline-offset-2')).toBe(true)
  })

  test('escapes hostile params rather than emitting them', () => {
    const $switch = render('filter-switch', {
      ...off,
      href: '"><script>alert(1)</script>',
      label: '<script>alert(1)</script>'
    })

    expect($switch('script')).toHaveLength(0)
  })
})
