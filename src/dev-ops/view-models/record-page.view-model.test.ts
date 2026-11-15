import {
  toSectionError,
  toTabHref,
  toTooLarge
} from './record-page.view-model.ts'

const tooLargeIn = (section: string) => [
  { section, message: 'too large to show' }
]

describe('toSectionError', () => {
  test("is the failed section's message", () => {
    expect(
      toSectionError(
        [{ section: 'definition', message: 'read failed' }],
        'definition'
      )
    ).toBe('read failed')
  })

  test('is never too large to show, which has its own warning', () => {
    expect(toSectionError(tooLargeIn('definition'), 'definition')).toBeNull()
  })

  test("ignores another section's failure", () => {
    expect(
      toSectionError([{ section: 'raw', message: 'read failed' }], 'definition')
    ).toBeNull()
  })
})

describe('toTooLarge', () => {
  test('is true only for the section it reads', () => {
    expect(toTooLarge(tooLargeIn('definition'), 'definition')).toBe(true)
    expect(toTooLarge(tooLargeIn('raw'), 'definition')).toBe(false)
  })

  test('is false for any other failure of the section', () => {
    expect(
      toTooLarge(
        [{ section: 'definition', message: 'read failed' }],
        'definition'
      )
    ).toBe(false)
  })
})

describe('toTabHref', () => {
  const href = '/dev-ops/grants/woodland/1.2.0'

  test('leaves out the default tab and an empty back', () => {
    expect(toTabHref(href, 'overview', '')).toBe(href)
  })

  test('keeps the tab and the list it came from', () => {
    expect(toTabHref(href, 'raw', '/dev-ops/grants')).toBe(
      `${href}?tab=raw&back=%2Fdev-ops%2Fgrants`
    )
  })

  test('adds the extra params after the tab and back', () => {
    expect(
      toTabHref(href, 'phases', '/dev-ops/grants', { status: 'P:S:A' })
    ).toBe(`${href}?tab=phases&back=%2Fdev-ops%2Fgrants&status=P%3AS%3AA`)
  })
})
