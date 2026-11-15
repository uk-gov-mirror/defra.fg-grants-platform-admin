import { ukZone } from './zoned-clock.ts'
import { applicationType } from './applications-page.view-model.ts'
import { caseType } from './cases-page.view-model.ts'
import {
  toCodesFact,
  toLinkFact,
  toRaw,
  toRecordPage,
  toReleaseCounterpartFacts,
  toSectionError,
  toSeriesData,
  toTabHref,
  toTextFact,
  toTooLarge,
  toVersionedFact,
  toVersionLinkOf
} from './record-page.view-model.ts'
import { toGrantHref } from './grants-page.view-model.ts'
import { toWorkflowHref, workflowType } from './workflows-page.view-model.ts'
import type { RecordPageData, SeriesMember } from './record-page.view-model.ts'

const now = new Date('2026-09-30T15:17:31.000Z')

const data = (overrides: Partial<RecordPageData> = {}): RecordPageData => ({
  ref: 'f02-7d8-a61',
  href: '/dev-ops/cases/woodland/f02-7d8-a61',
  position: { phase: null, stage: null, status: 'STATUS_IN_REVIEW' },
  facts: null,
  sourceErrors: [],
  sectionErrors: [],
  ...overrides
})

describe('toRecordPage', () => {
  test('names every missed source', () => {
    const page = toRecordPage(
      applicationType,
      data({ sourceErrors: [{ hop: 'CW-BE Cases' }, { hop: 'CW-BE Inbox' }] }),
      'overview',
      ukZone,
      '',
      now
    )

    expect(page.unavailableSources).toBe('CW-BE Cases, CW-BE Inbox')
  })

  const member = (ref: string): SeriesMember => ({
    ref,
    position: { phase: null, stage: null, status: 'STATUS_IN_REVIEW' },
    createdAt: '2026-09-29T15:02:44.000Z',
    closedAt: null
  })

  const hrefOf = (ref: string) => `/dev-ops/cases/woodland/${ref}`

  const seriesOf = (
    latestRef: string | null,
    refs: string[],
    members?: SeriesMember[]
  ) => toSeriesData({ latestRef, refs, members }, (known) => known, hrefOf)

  test('marks every member but the latest replaced, and links every one but this record', () => {
    const page = toRecordPage(
      caseType,
      data({
        series: seriesOf(
          '0aa-1bb-2cc',
          ['9d3-5b1-e08', 'f02-7d8-a61', '0aa-1bb-2cc'],
          []
        )
      }),
      'overview',
      ukZone,
      '',
      now
    )

    expect(
      page.series?.map(({ ref, href, replaced }) => ({ ref, href, replaced }))
    ).toEqual([
      {
        ref: '9d3-5b1-e08',
        href: '/dev-ops/cases/woodland/9d3-5b1-e08',
        replaced: true
      },
      { ref: 'f02-7d8-a61', href: null, replaced: true },
      {
        ref: '0aa-1bb-2cc',
        href: '/dev-ops/cases/woodland/0aa-1bb-2cc',
        replaced: false
      }
    ])
  })

  test('marks no member replaced when GAS names no latest', () => {
    const page = toRecordPage(
      caseType,
      data({
        series: seriesOf(null, ['9d3-5b1-e08', 'f02-7d8-a61'], [])
      }),
      'overview',
      ukZone,
      '',
      now
    )

    expect(page.series?.map(({ replaced }) => replaced)).toEqual([false, false])
  })

  test('has no series of fewer than two', () => {
    const page = toRecordPage(
      caseType,
      data({
        series: seriesOf(
          'f02-7d8-a61',
          ['f02-7d8-a61'],
          [member('f02-7d8-a61')]
        )
      }),
      'overview',
      ukZone,
      '',
      now
    )

    expect(page.series).toBeNull()
  })

  test('keeps a row for a ref GAS sent no member for, with nothing known of it', () => {
    const page = toRecordPage(
      caseType,
      data({
        series: seriesOf(
          'f02-7d8-a61',
          ['9d3-5b1-e08', 'f02-7d8-a61'],
          [member('f02-7d8-a61')]
        )
      }),
      'overview',
      ukZone,
      '',
      now
    )

    expect(page.seriesDetailed).toBe(true)
    expect(
      page.series?.map(({ ref, statusLabel, created }) => ({
        ref,
        statusLabel,
        created
      }))
    ).toEqual([
      { ref: '9d3-5b1-e08', statusLabel: null, created: null },
      {
        ref: 'f02-7d8-a61',
        statusLabel: 'In review',
        created: {
          text: '1d ago',
          instant: '2026-09-29T15:02:44Z',
          precise: '29 Sep 2026 16:02:44.000',
          clock: '29 Sep 16:02'
        }
      }
    ])
  })

  test.each([
    ['an ISO instant', '2026-09-30T15:10:31.000Z', '7m ago', '16:10:31'],
    [
      'a date only a lenient parser reads',
      '2026-06-16 10:00',
      '2026-06-16 10:00',
      ''
    ],
    ['a date in another shape', '29/09/2026', '29/09/2026', ''],
    ['an empty string', '', '""', '']
  ])('draws %s as the lists do, or as stored', (_, createdAt, text, clock) => {
    const page = toRecordPage(
      caseType,
      data({
        series: seriesOf(
          'f02-7d8-a61',
          ['9d3-5b1-e08', 'f02-7d8-a61'],
          [{ ...member('9d3-5b1-e08'), createdAt }, member('f02-7d8-a61')]
        )
      }),
      'overview',
      ukZone,
      '',
      now
    )

    expect(page.series?.[0].created).toMatchObject({ text, clock })
  })

  test('lists the refs alone when GAS sent no members at all', () => {
    const page = toRecordPage(
      caseType,
      data({ series: seriesOf('f02-7d8-a61', ['9d3-5b1-e08', 'f02-7d8-a61']) }),
      'overview',
      ukZone,
      '',
      now
    )

    expect(page.seriesDetailed).toBe(false)
    expect(
      page.series?.map(({ ref, replaced }) => `${ref} ${replaced}`)
    ).toEqual(['9d3-5b1-e08 true', 'f02-7d8-a61 false'])
  })

  test('links each tab off the record, marking the open one', () => {
    expect(
      toRecordPage(caseType, data(), 'raw', ukZone, '', now).tabs.map(
        ({ href, active }) => `${href} ${active}`
      )
    ).toEqual([
      '/dev-ops/cases/woodland/f02-7d8-a61 false',
      '/dev-ops/cases/woodland/f02-7d8-a61?tab=events false',
      '/dev-ops/cases/woodland/f02-7d8-a61?tab=raw true'
    ])
  })

  test("tells GAS's too large to show apart from a Raw error", () => {
    const tooLarge = toRecordPage(
      caseType,
      data({
        sectionErrors: [{ section: 'raw', message: 'too large to show' }]
      }),
      'raw',
      ukZone,
      '',
      now
    )
    const failed = toRecordPage(
      caseType,
      data({ sectionErrors: [{ section: 'raw', message: 'Raw failed' }] }),
      'raw',
      ukZone,
      '',
      now
    )

    expect(tooLarge).toMatchObject({
      raw: { view: null, tooLarge: true },
      sectionError: null
    })
    expect(failed).toMatchObject({
      raw: { view: null, tooLarge: false },
      sectionError: 'Raw failed'
    })
  })

  test('says a document too large to show on any tab but Raw, with no section error', () => {
    const page = toRecordPage(
      caseType,
      data({
        sectionErrors: [{ section: 'overview', message: 'too large to show' }]
      }),
      'overview',
      ukZone,
      '',
      now
    )

    expect(page).toMatchObject({ tooLarge: true, sectionError: null })
  })

  test('leaves too large to Raw on the Raw tab', () => {
    const page = toRecordPage(
      caseType,
      data({
        sectionErrors: [{ section: 'raw', message: 'too large to show' }]
      }),
      'raw',
      ukZone,
      '',
      now
    )

    expect(page).toMatchObject({ tooLarge: false, raw: { tooLarge: true } })
  })

  test('leaves Raw out on any other tab', () => {
    expect(
      toRecordPage(
        caseType,
        data({ raw: { caseRef: 'x' } }),
        'overview',
        ukZone,
        '',
        now
      ).raw
    ).toBeNull()
  })

  test('says when there are more events than the tab shows', () => {
    expect(
      toRecordPage(
        caseType,
        data({ events: { rows: [], more: true } }),
        'events',
        ukZone,
        '',
        now
      ).events
    ).toEqual({ rows: [], more: true })
  })

  test('leaves the way back to the layout when opened from no list', () => {
    expect(
      toRecordPage(caseType, data(), 'overview', ukZone, '', now)
    ).toMatchObject({
      backHref: ''
    })
  })

  test('goes back to the list it was opened from, and keeps it on every tab', () => {
    const from = '/dev-ops/cases?workflow=woodland'
    const page = toRecordPage(caseType, data(), 'overview', ukZone, from, now)

    expect(page.backHref).toBe(from)
    expect(page.tabs.map(({ href }) => href)).toEqual([
      '/dev-ops/cases/woodland/f02-7d8-a61?back=%2Fdev-ops%2Fcases%3Fworkflow%3Dwoodland',
      '/dev-ops/cases/woodland/f02-7d8-a61?tab=events&back=%2Fdev-ops%2Fcases%3Fworkflow%3Dwoodland',
      '/dev-ops/cases/woodland/f02-7d8-a61?tab=raw&back=%2Fdev-ops%2Fcases%3Fworkflow%3Dwoodland'
    ])
  })
})

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

describe('toVersionedFact', () => {
  const versions = {
    code: 'woodland-creation',
    currentConfigVersion: '1.2.0',
    originalConfigVersion: '1.1.0'
  }

  test('links the version to its page, with where it started', () => {
    expect(
      toVersionedFact('grant', 'Grant', versions, '/dev-ops/grants/x/1.2.0')
    ).toEqual({
      id: 'grant',
      label: 'Grant',
      kind: 'mono',
      text: 'woodland-creation@1.2.0',
      from: '1.1.0',
      href: '/dev-ops/grants/x/1.2.0'
    })
  })

  test('is plain text when there is no page to link to', () => {
    expect(
      toVersionedFact(
        'grant',
        'Grant',
        { ...versions, currentConfigVersion: null },
        null
      )
    ).toEqual({
      id: 'grant',
      label: 'Grant',
      kind: 'mono',
      text: 'woodland-creation',
      from: '1.1.0',
      href: null
    })
  })
})

describe('toVersionLinkOf', () => {
  test("leads back to the record's Overview, which keeps its own way back", () => {
    expect(
      toVersionLinkOf(
        toGrantHref,
        'woodland-creation',
        '1.2.0',
        '/dev-ops/applications/woodland-creation/a7c',
        '/dev-ops/applications?grant=woodland-creation'
      )
    ).toBe(
      '/dev-ops/grants/woodland-creation/1.2.0?back=%2Fdev-ops%2Fapplications%2Fwoodland-creation%2Fa7c%3Fback%3D%252Fdev-ops%252Fapplications%253Fgrant%253Dwoodland-creation'
    )
  })

  test('leads back to the bare record when it was opened directly', () => {
    expect(
      toVersionLinkOf(
        toWorkflowHref,
        'woodland',
        '1.4.2',
        '/dev-ops/cases/woodland/f02',
        ''
      )
    ).toBe(
      '/dev-ops/workflows/woodland/1.4.2?back=%2Fdev-ops%2Fcases%2Fwoodland%2Ff02'
    )
  })

  test("shortens the record's own way back when it would not fit", () => {
    const from = `/dev-ops/applications?grant=${'a'.repeat(2048)}`

    expect(
      toVersionLinkOf(
        toGrantHref,
        'woodland-creation',
        '1.2.0',
        '/dev-ops/applications/woodland-creation/a7c',
        from
      )
    ).toBe(
      '/dev-ops/grants/woodland-creation/1.2.0?back=%2Fdev-ops%2Fapplications%2Fwoodland-creation%2Fa7c%3Fback%3D%252Fdev-ops%252Fapplications'
    )
  })

  test('is null without a version to link to', () => {
    expect(
      toVersionLinkOf(
        toGrantHref,
        'woodland-creation',
        null,
        '/dev-ops/applications/woodland-creation/a7c',
        ''
      )
    ).toBeNull()
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
