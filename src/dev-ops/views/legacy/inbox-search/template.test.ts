import { render } from '../../../test-utils.ts'

describe('inbox-search component', () => {
  test("posts a Reference search for the code to the service's inbox", () => {
    const $ = render('inbox-search', {
      service: 'GAS',
      code: 'woodland',
      text: 'Search',
      testId: 'search'
    })
    const form = $('[data-testid="search"]')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe('/dev-ops/events/gas/inbox')
    expect(
      form
        .find('input')
        .toArray()
        .map((input) => [$(input).attr('name'), $(input).attr('value')])
    ).toEqual([
      ['ref-kind', 'ref'],
      ['ref-value', 'woodland']
    ])
    expect($('[data-testid="search-link"]').attr('class')).toBe('link')
    expect($('[data-testid="search-link"]').text()).toBe('Search')
  })

  test("goes to CW's inbox for a workflow, with the caller's words", () => {
    const $ = render(
      'inbox-search',
      { service: 'CW', code: 'woodland', testId: 'search' },
      'search for <code>woodland</code>'
    )

    expect($('form').attr('action')).toBe('/dev-ops/events/cw/inbox')
    expect($('[data-testid="search-link"] code').text()).toBe('woodland')
  })
})
