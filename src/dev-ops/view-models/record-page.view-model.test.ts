import {
  toCodesFact,
  toLinkFact,
  toRaw,
  toReleaseCounterpartFacts,
  toSectionError,
  toTabHref,
  toTextFact,
  toTooLarge
} from './record-page.view-model.ts'
import { workflowType } from './workflows-page.view-model.ts'

const tooLargeIn = (section: string) => [
  { section, message: 'too large to show' }
]

describe('toRaw', () => {
  test('is too large only for the section it reads', () => {
    expect(toRaw(null, tooLargeIn('definition'), 'definition')).toEqual({
      view: null,
      tooLarge: true
    })
    expect(toRaw(null, tooLargeIn('definition'), 'raw')).toEqual({
      view: null,
      tooLarge: false
    })
  })

  test('draws the document it is given', () => {
    expect(toRaw({ code: 'x' }, [], 'definition').view).not.toBeNull()
  })
})

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

describe('toTextFact', () => {
  test('is the value as it is', () => {
    expect(toTextFact('description', 'Description', 'Woodland')).toEqual({
      id: 'description',
      label: 'Description',
      kind: 'text',
      text: 'Woodland'
    })
  })

  test('reads a dash for no value', () => {
    expect(toTextFact('description', 'Description', null)).toEqual({
      id: 'description',
      label: 'Description',
      kind: 'none'
    })
  })
})

describe('toLinkFact', () => {
  test('links the text to the href', () => {
    expect(
      toLinkFact('who-can-apply', 'Who can apply', 'Allow list', '/admin')
    ).toEqual({
      id: 'who-can-apply',
      label: 'Who can apply',
      kind: 'link',
      text: 'Allow list',
      href: '/admin'
    })
  })

  test('reads a dash, never a link, when there is nowhere to go', () => {
    expect(
      toLinkFact('applications', 'Applications', 'View applications', null)
    ).toEqual({
      id: 'applications',
      label: 'Applications',
      kind: 'none'
    })
  })
})

describe('toCodesFact', () => {
  test('keeps the codes in order', () => {
    expect(toCodesFact('roles', 'Roles', ['B_ROLE', 'A_ROLE'])).toEqual({
      id: 'roles',
      label: 'Roles',
      kind: 'codes',
      codes: ['B_ROLE', 'A_ROLE']
    })
  })

  test.each([
    ['no list', null],
    ['an empty list', []]
  ])('reads a dash for %s', (_, codes) => {
    expect(toCodesFact('roles', 'Roles', codes)).toEqual({
      id: 'roles',
      label: 'Roles',
      kind: 'none'
    })
  })
})

describe('toReleaseCounterpartFacts', () => {
  const href = '/dev-ops/workflows/woodland-creation/1.2.0'

  test('links to a version the other service has', () => {
    expect(
      toReleaseCounterpartFacts(workflowType, { exists: true }, href)
    ).toEqual([
      {
        id: 'workflow',
        label: 'Workflow',
        kind: 'link',
        text: 'View workflow',
        href
      }
    ])
  })

  test('says None when the other service has no such version', () => {
    expect(
      toReleaseCounterpartFacts(workflowType, { exists: false }, href)
    ).toEqual([
      { id: 'workflow', label: 'Workflow', kind: 'text', text: 'None' }
    ])
  })

  test('has no row when the other service could not say', () => {
    expect(toReleaseCounterpartFacts(workflowType, null, href)).toEqual([])
  })
})
