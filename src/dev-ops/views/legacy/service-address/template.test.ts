import { render } from '../../../test-utils.ts'

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const address = (url: string | null, extra: object = {}) =>
  render('service-address', {
    method: 'POST',
    path: '/api/v2/parcels/{sbi}',
    url,
    service: 'LAND_DATA',
    source: 'GAS',
    environment: 'dev',
    testId: 'calls',
    ...extra
  })

describe('service-address component', () => {
  test('gives the method and the address on one line, and the service beneath it', () => {
    const $ = address('https://land-data.example/api/v2/parcels/{sbi}')

    expect($('[data-testid="calls-method"]').text()).toBe('POST')
    expect($('[data-testid="calls-url"]').text()).toBe(
      'https://land-data.example/api/v2/parcels/{sbi}'
    )
    expect($('[data-testid="calls-url"] wbr').length).toBeGreaterThan(0)
    expect($('[data-testid="calls-path"]')).toHaveLength(0)
    expect($('[data-testid="calls-not-configured"]')).toHaveLength(0)
    expect($('[data-testid="calls-service"]').text()).toBe('LAND_DATA')
    expect($('[data-testid="calls-service"]').attr('class')).toBe(
      'text-base-content/70'
    )
    expect($('[data-testid="calls"]').attr('class')).toContain('items-baseline')
  })

  test('says the variable is unset only when GAS says the service is missing', () => {
    const $ = address(null, { unset: true })

    expect($('[data-testid="calls-url"]')).toHaveLength(0)
    expect($('[data-testid="calls-path"]').text()).toBe('/api/v2/parcels/{sbi}')
    expect(flatten($('[data-testid="calls-not-configured"]').text())).toBe(
      'not configured in GAS on dev (LAND_DATA_URL unset)'
    )
    expect($('[data-testid="calls-no-url"]')).toHaveLength(0)
  })

  test('says only that there is no usable URL otherwise, since an unparseable one is null too', () => {
    const $ = address(null, { unset: false })

    expect(flatten($('[data-testid="calls-no-url"]').text())).toBe(
      'no usable URL in GAS on dev (LAND_DATA_URL unset or invalid)'
    )
    expect($('[data-testid="calls-not-configured"]')).toHaveLength(0)
  })

  test('says nothing beyond the path when GAS does not say which services are missing', () => {
    const $ = address(null)

    expect($('[data-testid="calls-path"]').text()).toBe('/api/v2/parcels/{sbi}')
    expect($('[data-testid="calls-not-configured"]')).toHaveLength(0)
    expect($('[data-testid="calls-no-url"]')).toHaveLength(0)
  })

  test('names CW for a workflow, and leaves the environment out when there is none', () => {
    const $ = address(null, { source: 'CW', environment: '', unset: false })

    expect(flatten($('[data-testid="calls-no-url"]').text())).toBe(
      'no usable URL in CW (LAND_DATA_URL unset or invalid)'
    )
  })

  test('shows a missing service as no value, and names no variable', () => {
    const $ = address(null, { service: null, unset: false })

    expect($('[data-testid="calls-service"]').text()).toBe('—')
    expect(flatten($('[data-testid="calls-no-url"]').text())).toBe(
      'no usable URL in GAS on dev'
    )
  })

  test('leaves the method out when there is none', () => {
    const $ = address('https://h/x', { method: null })

    expect($('[data-testid="calls-method"]')).toHaveLength(0)
  })

  test('escapes markup in an address', () => {
    const $ = address('https://h/<b>x</b>')

    expect($('[data-testid="calls-url"]').text()).toBe('https://h/<b>x</b>')
    expect($('[data-testid="calls-url"] b')).toHaveLength(0)
  })
})
