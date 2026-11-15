import {
  casesBucket,
  catalogue,
  outboxBucket,
  auditedOutbox
} from '../use-cases/test-fixtures.ts'
import { toBucketHref, toRowHref, toVersionListHref } from './bucket-links.ts'

const from = '/dev-ops/events/gas/outbox?status=DEAD_LETTER'

const backTo = `?back=${encodeURIComponent(from)}`

describe('toBucketHref', () => {
  test('is the bare list at its declared path with no filter', () => {
    expect(toBucketHref(outboxBucket, {})).toBe('/dev-ops/events/gas/outbox')
  })

  test('spells each fact by its URL key, repeats one with several values, and leaves out an unset one', () => {
    expect(
      toBucketHref(auditedOutbox, {
        status: ['DEAD_LETTER', 'FAILED'],
        'lastError.name': 'TypeError',
        grantCode: undefined,
        from: '2026-10-08T12:00:00.000Z',
        range: '24h'
      })
    ).toBe(
      '/dev-ops/events/gas/outbox?status=DEAD_LETTER&status=FAILED&error=TypeError&from=2026-10-08T12%3A00%3A00.000Z&range=24h'
    )
  })

  test('puts a position ahead of the filters', () => {
    expect(
      toBucketHref(
        outboxBucket,
        { status: 'DEAD_LETTER' },
        new URLSearchParams({ cursor: 'eyJ0Ijoi' })
      )
    ).toBe('/dev-ops/events/gas/outbox?cursor=eyJ0Ijoi&status=DEAD_LETTER')
  })
})

describe('toVersionListHref', () => {
  const caseFacts = {
    codeFact: 'workflowCode',
    versionFact: 'currentConfigVersion'
  }
  const ref = { code: 'woodland-creation', version: '1.2.0' }

  test('filters the list by the code and the version', () => {
    expect(toVersionListHref(catalogue, 'cw.cases', caseFacts, ref)).toBe(
      '/dev-ops/cases?workflow=woodland-creation&version=1.2.0'
    )
  })

  test('is null when the list does not declare both facts', () => {
    const narrowed = {
      ...catalogue,
      buckets: [{ ...casesBucket, facts: casesBucket.facts.slice(0, 1) }]
    }

    expect(toVersionListHref(narrowed, 'cw.cases', caseFacts, ref)).toBeNull()
  })

  test('is null when the list is missing or there is no catalogue', () => {
    expect(
      toVersionListHref(catalogue, 'cw.nothing', caseFacts, ref)
    ).toBeNull()
    expect(toVersionListHref(null, 'cw.cases', caseFacts, ref)).toBeNull()
  })
})

describe('toRowHref', () => {
  test('shortens a way back too long for the page it opens to accept', () => {
    const long = `/dev-ops/events/gas/outbox?back=${encodeURIComponent(`/dev-ops/grants?q=${'a'.repeat(2048)}`)}`
    const href = toRowHref(
      {
        kind: 'event',
        service: 'gas',
        box: 'outbox',
        id: '66f000000000000000000001'
      },
      long
    )

    expect(new URL(href ?? '', 'http://gpa').searchParams.get('back')).toBe(
      '/dev-ops/events/gas/outbox'
    )
  })

  test('opens a CW event under cw, as its lists are', () => {
    expect(
      toRowHref(
        {
          kind: 'event',
          service: 'caseworking',
          box: 'inbox',
          id: '66f000000000000000000001'
        },
        from
      )
    ).toBe(`/dev-ops/events/cw/inbox/66f000000000000000000001${backTo}`)
  })

  test('opens an event on its page, told which list to go back to', () => {
    expect(
      toRowHref(
        {
          kind: 'event',
          service: 'gas',
          box: 'outbox',
          id: '66f000000000000000000001'
        },
        from
      )
    ).toBe(`/dev-ops/events/gas/outbox/66f000000000000000000001${backTo}`)
  })

  test('opens an application on its page', () => {
    expect(
      toRowHref(
        { kind: 'application', code: 'example-grant', clientRef: 'abc-123' },
        from
      )
    ).toBe(`/dev-ops/applications/example-grant/abc-123${backTo}`)
  })

  test('opens a case on its page', () => {
    expect(
      toRowHref(
        { kind: 'case', workflowCode: 'example-workflow', caseRef: 'abc-123' },
        from
      )
    ).toBe(`/dev-ops/cases/example-workflow/abc-123${backTo}`)
  })

  test('opens a grant version on its page', () => {
    expect(
      toRowHref(
        { kind: 'grant', code: 'woodland-creation', version: '1.2.0' },
        from
      )
    ).toBe(`/dev-ops/grants/woodland-creation/1.2.0${backTo}`)
  })

  test('opens a workflow version on its page, escaping its code', () => {
    expect(
      toRowHref({ kind: 'workflow', code: 'FRPS/2', version: '1.0.0' }, from)
    ).toBe(`/dev-ops/workflows/FRPS%2F2/1.0.0${backTo}`)
  })

  test('escapes each part of the address', () => {
    expect(
      toRowHref({ kind: 'application', code: 'a/b', clientRef: 'c?d' }, '')
    ).toBe('/dev-ops/applications/a%2Fb/c%3Fd?back=')
  })

  test.each([
    ['a row with no link', null],
    ['a kind this app has no page for', { kind: 'payment', id: 'p-1' }],
    ['a link missing part of its address', { kind: 'case', caseRef: 'abc' }],
    [
      'a grant link missing its version',
      { kind: 'grant', code: 'woodland-creation' }
    ],
    [
      'a link whose address is not text',
      { kind: 'application', code: 'example-grant', clientRef: 7 }
    ],
    ['a kind spelled like a built-in', { kind: 'constructor' }]
  ])('makes no link of %s', (_name, link) => {
    expect(toRowHref(link, from)).toBeNull()
  })
})
