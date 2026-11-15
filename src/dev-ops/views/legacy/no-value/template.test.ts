import { render } from '../../../test-utils.ts'

describe('no-value component', () => {
  test('draws a muted mono dash, named for its value', () => {
    const $ = render('no-value', { testId: 'grant-size' })
    const dash = $('[data-testid="grant-size-none"]')

    expect(dash.text()).toBe('—')
    expect(dash.attr('class')).toBe('font-mono text-sm text-base-content/70')
  })

  test('needs no name', () => {
    const $ = render('no-value', {})

    expect($('span').text()).toBe('—')
    expect($('span').attr('data-testid')).toBeUndefined()
  })
})
