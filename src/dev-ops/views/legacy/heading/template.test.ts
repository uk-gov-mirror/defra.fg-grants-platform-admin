import { render } from '../../../test-utils.ts'

describe('dev-ops heading component', () => {
  test('renders the heading with its title and caption', () => {
    const $heading = render('heading', {
      text: 'Operations Admin',
      caption: 'fg-grants-platform-admin'
    })

    expect($heading('[data-testid="do-heading"]')).toHaveLength(1)
    expect($heading('[data-testid="do-heading-title"]').text().trim()).toBe(
      'Operations Admin'
    )
    expect($heading('[data-testid="do-heading-caption"]').text().trim()).toBe(
      'fg-grants-platform-admin'
    )
    expect($heading('[data-testid="do-heading-caption"]').attr('class')).toBe(
      'text-sm text-base-content/70'
    )
  })

  test('omits the caption when none is given', () => {
    const $heading = render('heading', { text: 'Operations Admin' })

    expect($heading('[data-testid="do-heading-caption"]')).toHaveLength(0)
  })
})
