import { render } from '../../../test-utils.ts'

const badge = (params: object) =>
  render('status-badge', params)('[data-testid="do-status-badge"]')

describe('status-badge component', () => {
  test('shows the label it is given and hangs the raw status off the title', () => {
    const $badge = badge({
      status: 'DEAD_LETTER',
      label: 'Dead letter',
      role: 'error'
    })

    expect($badge.text()).toBe('Dead letter')
    expect($badge.attr('title')).toBe('DEAD_LETTER')
  })

  const dotClass = (params: object) =>
    render(
      'status-badge',
      params
    )('[data-testid="do-status-dot"]').attr('class')

  const labelClass = (params: object) =>
    render(
      'status-badge',
      params
    )('[data-testid="do-status-label"]').attr('class')

  test('draws every status as a dot and a label, in that order', () => {
    const $badge = badge({
      status: 'PROCESSING',
      label: 'Processing',
      role: 'info'
    })

    expect($badge.children()).toHaveLength(2)
    expect($badge.children().first().attr('data-testid')).toBe('do-status-dot')
    expect($badge.children().last().attr('data-testid')).toBe('do-status-label')
    expect($badge.attr('class')).toContain('inline-flex')
  })

  test('dots the neutral role in the text colour, which reads on either theme', () => {
    expect(dotClass({ status: 'PUBLISHED', role: 'neutral' })).toBe(
      'status bg-base-content/80'
    )
  })

  test('dots the informational role', () => {
    expect(dotClass({ status: 'PROCESSING', role: 'info' })).toBe(
      'status status-info'
    )
  })

  test('dots the warning role', () => {
    expect(dotClass({ status: 'FAILED', role: 'warning' })).toBe(
      'status status-warning'
    )
  })

  test('dots the error role', () => {
    expect(dotClass({ status: 'DEAD_LETTER', role: 'error' })).toBe(
      'status status-error'
    )
  })

  test('dots the success role, and gives it the same anatomy as the others', () => {
    const $badge = badge({
      status: 'COMPLETED',
      label: 'Completed',
      role: 'success'
    })

    expect($badge.find('[data-testid="do-status-dot"]').attr('class')).toBe(
      'status status-success'
    )
    expect($badge.text()).toBe('Completed')
    expect($badge.attr('title')).toBe('COMPLETED')
  })

  test('recedes the completed label and holds the dead letter one at full contrast', () => {
    expect(labelClass({ status: 'COMPLETED', role: 'success' })).toBe(
      'text-base-content/70'
    )
    expect(labelClass({ status: 'DEAD_LETTER', role: 'error' })).toBe(
      'font-medium'
    )
  })

  test('sets every other label at one muted weight', () => {
    expect(labelClass({ status: 'PUBLISHED', role: 'neutral' })).toBe(
      'text-base-content/80'
    )
    expect(labelClass({ status: 'PROCESSING', role: 'info' })).toBe(
      'text-base-content/80'
    )
    expect(labelClass({ status: 'FAILED', role: 'warning' })).toBe(
      'text-base-content/80'
    )
  })

  test('hides the dot from assistive technology, which reads the label', () => {
    expect(
      badge({ status: 'FAILED', role: 'warning' })
        .find('[data-testid="do-status-dot"]')
        .attr('aria-hidden')
    ).toBe('true')
  })

  test("carries no pill classes by default, daisyUI's or this app's own", () => {
    const html = render('status-badge', {
      status: 'DEAD_LETTER',
      label: 'Dead letter',
      role: 'error'
    }).html()

    expect(html).not.toContain('do-badge')
    expect(html).not.toContain('do-status-quiet')
    expect(html).not.toContain('badge-error')
    expect(html).not.toContain('uppercase')
  })

  test('says every status as a dot unless the solid variant is asked for', () => {
    const $badge = badge({
      status: 'DEAD_LETTER',
      label: 'Dead letter',
      role: 'error',
      variant: 'badge'
    })

    expect($badge.attr('class')).toBe(
      'inline-flex items-center gap-1.5 whitespace-nowrap'
    )
    expect($badge.find('[data-testid="do-status-dot"]')).toHaveLength(1)
    expect($badge.html()).not.toContain('badge-soft')
  })

  test('draws the solid variant as a filled badge, never a soft one', () => {
    const solid = (role: string) =>
      badge({ status: 'X', label: 'X', role, variant: 'solid' }).attr('class')

    expect(solid('neutral')).toBe('badge badge-neutral')
    expect(solid('info')).toBe('badge badge-info')
    expect(solid('warning')).toBe('badge badge-warning')
    expect(solid('success')).toBe('badge badge-success')
    expect(solid('error')).toBe('badge badge-error')
    expect(
      badge({ status: 'X', role: 'error', variant: 'solid' }).html()
    ).not.toContain('badge-soft')
  })

  test('keeps the retry glyph and the raw status on the solid variant', () => {
    const $badge = badge({
      status: 'FAILED',
      label: 'Failed',
      role: 'warning',
      retrying: true,
      variant: 'solid'
    })

    expect($badge.text()).toBe('Failed ↻')
    expect($badge.attr('title')).toBe('FAILED')
    expect($badge.find('[data-testid="do-status-label"]')).toHaveLength(1)
  })

  test('falls back to the neutral fill for a solid role it does not know', () => {
    expect(
      badge({ status: 'X', role: 'chartreuse', variant: 'solid' }).attr('class')
    ).toBe('badge badge-neutral')
  })

  test('falls back to the quietest dot for a role it does not know', () => {
    expect(dotClass({ status: 'PUBLISHED', role: 'chartreuse' })).toBe('status')
    expect(labelClass({ status: 'PUBLISHED', role: 'chartreuse' })).toBe(
      'text-base-content/80'
    )
  })

  test('keeps every status on one badge testid', () => {
    expect(badge({ status: 'COMPLETED', role: 'success' })).toHaveLength(1)
    expect(badge({ status: 'DEAD_LETTER', role: 'error' })).toHaveLength(1)
  })

  test('falls back to the quietest dot when no role is given', () => {
    expect(dotClass({ status: 'PUBLISHED' })).toBe('status')
  })

  test('trails a retrying status with the retry glyph', () => {
    expect(
      badge({
        status: 'FAILED',
        label: 'Failed',
        role: 'warning',
        retrying: true
      }).text()
    ).toBe('Failed ↻')
  })

  test('omits the retry glyph otherwise', () => {
    expect(
      badge({
        status: 'COMPLETED',
        label: 'Completed',
        role: 'success',
        retrying: false
      }).text()
    ).toBe('Completed')
  })

  test('carries no icon of its own', () => {
    expect(
      badge({
        status: 'FAILED',
        label: 'Failed',
        role: 'warning',
        retrying: true
      }).find('svg')
    ).toHaveLength(0)
  })

  test('falls back to the raw status of one it has no label for', () => {
    expect(badge({ status: 'QUARANTINED', role: 'neutral' }).text()).toBe(
      'QUARANTINED'
    )
  })

  test('escapes a status containing markup', () => {
    const $badge = render('status-badge', {
      status: '<script>alert(1)</script>',
      role: 'neutral'
    })

    expect($badge('script')).toHaveLength(0)
  })
})
