import { render } from '../../../test-utils.ts'

const statusText = (params: object) => render('status-text', params)

describe('status-text component', () => {
  test('shows the status alone, spoken as the whole position and lifted over nothing', () => {
    const $ = statusText({
      statusLabel: 'In review',
      positionLabel: 'Pre award › Assessment › In review',
      testId: 'case-status-label'
    })
    const label = $('[data-testid="case-status-label"]')

    expect(label.text()).toBe('In review')
    expect(label.attr('title')).toBe('In review')
    expect($('.relative')).toHaveLength(0)
    expect(label.attr('aria-hidden')).toBe('true')
    expect($('.sr-only').text()).toBe('Pre award › Assessment › In review')
    expect($('.status')).toHaveLength(0)
  })

  test('draws a dash for a record with no status', () => {
    const $ = statusText({
      statusLabel: null,
      positionLabel: '',
      testId: 'case-status-label'
    })

    expect($('[data-testid="case-status-label-none"]').text()).toBe('—')
    expect($('[data-testid="case-status-label"]')).toHaveLength(0)
  })
})
