import { fromMax, toBackLabel, toFittingBack } from './record-filters.ts'

describe('toBackLabel', () => {
  const lists = { listLabel: null, ownListLabel: 'Grants' }

  test.each([
    ['/dev-ops/applications/woodland/abc-123', 'Back to application'],
    ['/dev-ops/cases/woodland/abc-123?tab=events', 'Back to case'],
    [
      '/dev-ops/grants/qa-complex/1.1.0?tab=phases&back=%2Fdev-ops%2Fgrants',
      'Back to grant qa-complex@1.1.0'
    ],
    [
      '/dev-ops/workflows/qa-complex/1.1.0',
      'Back to workflow qa-complex@1.1.0'
    ],
    ['/dev-ops/events/gas/inbox/6ad9086d1650ab8312898a92', 'Back to event']
  ])('names the page %s leads to', (back, label) => {
    expect(toBackLabel(back, lists)).toBe(label)
  })

  test('names a version whose code is not valid percent-encoding as written', () => {
    expect(toBackLabel('/dev-ops/grants/%E0/1.0.0', lists)).toBe(
      'Back to grant %E0@1.0.0'
    )
  })

  test('names a list by its own label', () => {
    expect(
      toBackLabel('/dev-ops/applications?grant=woodland', {
        listLabel: 'Applications',
        ownListLabel: 'Grants'
      })
    ).toBe('Back to Applications')
  })

  test("names the page's own list for anything else, or nothing", () => {
    expect(toBackLabel('', lists)).toBe('Back to Grants')
    expect(toBackLabel('/dev-ops/somewhere', lists)).toBe('Back to Grants')
  })
})

describe('toFittingBack', () => {
  const nest = (depth: number, list: string): string =>
    depth === 0
      ? list
      : `/dev-ops/grants/woodland/1.${depth}.0?tab=phases&back=${encodeURIComponent(nest(depth - 1, list))}`

  test('leaves a back that fits as it is', () => {
    const back = nest(2, '/dev-ops/grants?grant=woodland')

    expect(toFittingBack(back)).toBe(back)
  })

  test('drops the innermost back first until the whole fits', () => {
    const long = nest(3, `/dev-ops/grants?grant=${'x'.repeat(fromMax)}`)
    const fitted = toFittingBack(long)

    expect(long.length).toBeGreaterThan(fromMax)
    expect(fitted).toBe(
      `/dev-ops/grants/woodland/1.3.0?tab=phases&back=${encodeURIComponent(
        `/dev-ops/grants/woodland/1.2.0?tab=phases&back=${encodeURIComponent('/dev-ops/grants/woodland/1.1.0?tab=phases')}`
      )}`
    )
  })

  test('keeps the query of an innermost page whose params only end in back', () => {
    const inner = `/dev-ops/applications?feedback=${'x'.repeat(fromMax)}&grant=woodland`
    const long = `/dev-ops/grants/woodland/1.2.0?tab=phases&back=${encodeURIComponent(inner)}`

    expect(toFittingBack(long)).toBe(
      '/dev-ops/grants/woodland/1.2.0?tab=phases'
    )
  })
})
