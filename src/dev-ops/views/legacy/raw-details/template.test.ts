import { render } from '../../../test-utils.ts'
import { toJsonView } from '../../../view-models/json-viewer.view-model.ts'

const view = toJsonView({ code: 'woodland' })

describe('raw-details component', () => {
  test('is closed and says Raw unless told otherwise', () => {
    const $ = render('raw-details', { view, label: 'Doc', testId: 'raw' })

    expect($('[data-testid="raw-details"]').attr('open')).toBeUndefined()
    expect($('[data-testid="raw-summary"]').text()).toBe('Raw')
  })

  test('takes its own summary, and opens when asked', () => {
    const $ = render('raw-details', {
      view,
      label: 'Doc',
      summary: 'Raw payment definition (JSON)',
      open: true,
      testId: 'raw'
    })

    expect($('[data-testid="raw-details"]').attr('open')).toBe('open')
    expect($('[data-testid="raw-summary"]').text()).toBe(
      'Raw payment definition (JSON)'
    )
  })
})
