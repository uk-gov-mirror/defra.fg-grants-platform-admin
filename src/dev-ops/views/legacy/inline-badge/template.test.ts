import { render } from '../../../test-utils.ts'

describe('inline-badge component', () => {
  test('is a small quiet badge by default', () => {
    const $ = render('inline-badge', { text: 'closed', testId: 'b' })

    expect($('[data-testid="b"]').attr('class')).toBe(
      'badge badge-ghost badge-sm'
    )
    expect($('[data-testid="b"]').text()).toBe('closed')
  })

  test('takes a tone, a title, more classes and a sentence for screen readers', () => {
    const $ = render('inline-badge', {
      text: 'needs tasks',
      tone: 'warning',
      title: 'Hidden until tasks are done',
      class: 'ml-1.5',
      srText: 'hidden until tasks are done',
      testId: 'b'
    })
    const badge = $('[data-testid="b"]')

    expect(badge.attr('class')).toBe(
      'badge badge-warning badge-soft badge-sm ml-1.5'
    )
    expect(badge.attr('title')).toBe('Hidden until tasks are done')
    expect(badge.find('.sr-only').text()).toBe(': hidden until tasks are done')
  })
})
