import { render } from '../../../test-utils.ts'

describe('name-code component', () => {
  test('writes the name, then the code muted after it', () => {
    const $ = render('name-code', {
      name: 'Pre-award',
      code: 'PHASE_PRE_AWARD',
      testId: 'title'
    })

    expect($('[data-testid="title"]').text()).toBe('Pre-award PHASE_PRE_AWARD')
    expect($('[data-name]').text()).toBe('Pre-award')
    expect($('[data-code] > span').attr('class')).toBe(
      'font-mono [overflow-wrap:anywhere] text-xs text-base-content/70'
    )
    expect($('[data-code] wbr')).toHaveLength(2)
  })

  test('puts the code beneath the name when stacked', () => {
    const $ = render('name-code', {
      name: 'Pre-award',
      code: 'PRE_AWARD',
      layout: 'stacked'
    })

    expect($('span').first().attr('class')).toBe('flex min-w-0 flex-col')
    expect($('[data-code]').attr('class')).toBe('block')
  })

  test('writes the code alone, unmuted, when there is no name', () => {
    const $ = render('name-code', { name: null, code: 'CLOSED' })

    expect($('[data-name]')).toHaveLength(0)
    expect($('body').text()).toBe('CLOSED')
    expect($('.text-base-content\\/70')).toHaveLength(0)
  })
})
