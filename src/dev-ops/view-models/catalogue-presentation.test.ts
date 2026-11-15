import {
  casesBucket,
  cwInbox,
  cwOutbox,
  gasInbox,
  gasOutbox,
  grantsBucket,
  applicationsBucket,
  workflowsBucket
} from '../use-cases/test-fixtures.ts'
import type { BucketEntry } from '../use-cases/get-catalogue.use-case.ts'
import {
  cataloguePresentation,
  toFactLabel,
  toListColumns,
  toTimeLabel,
  toTone,
  toVersionColumn
} from './catalogue-presentation.ts'

const columns = (bucket: BucketEntry) =>
  toListColumns(bucket).map(({ key, label, width, mono, align }) => ({
    key,
    label,
    width,
    mono,
    align
  }))

describe('the event lists', () => {
  test.each([gasOutbox, gasInbox, cwOutbox, cwInbox])(
    '$id: Event, Event ID, Status, Created, at the prototype’s widths',
    (bucket) => {
      expect(columns(bucket)).toEqual([
        {
          key: 'title',
          label: 'Event',
          width: 'minmax(220px, 1fr)',
          mono: false,
          align: 'start'
        },
        {
          key: 'subtitle',
          label: 'Event ID',
          width: '336px',
          mono: true,
          align: 'start'
        },
        {
          key: 'status',
          label: 'Status',
          width: '128px',
          mono: false,
          align: 'start'
        },
        {
          key: 'time',
          label: 'Created',
          width: 'var(--size-column-date)',
          mono: false,
          align: 'right'
        }
      ])
    }
  )

  test('the inbox’s Received is Created, as on the outbox', () => {
    expect(gasInbox.time.label).toBe('Received')
    expect(toTimeLabel(gasInbox)).toBe('Created')
  })

  test.each([
    ['PUBLISHED', 'neutral', 'info'],
    ['PROCESSING', 'info', 'info'],
    ['FAILED', 'warning', 'danger'],
    ['RESUBMITTED', 'warning', 'warning'],
    ['COMPLETED', 'success', 'success'],
    ['DEAD_LETTER', 'error', 'danger'],
    ['PURGED', 'neutral', 'neutral']
  ] as const)('%s, declared %s, is drawn %s', (value, declared, tone) => {
    expect(toTone(gasOutbox, 'status', value, declared)).toBe(tone)
    expect(toTone(cwInbox, 'status', value, declared)).toBe(tone)
  })
})

describe('Applications and Cases', () => {
  test('Applications: Reference, Grant, Received; no position', () => {
    expect(columns(applicationsBucket).map(({ label }) => label)).toEqual([
      'Reference',
      'Grant',
      'Received'
    ])
    expect(columns(applicationsBucket)[0].mono).toBe(true)
  })

  test('Cases: Reference, Grant, and CW’s own Created', () => {
    expect(columns(casesBucket).map(({ label }) => label)).toEqual([
      'Reference',
      'Grant',
      'Created'
    ])
  })

  test.each([applicationsBucket, casesBucket])(
    '$id: widths that no row can change, so loading more keeps the columns still',
    (bucket) => {
      expect(columns(bucket).map(({ width }) => width)).toEqual([
        'minmax(180px, 1fr)',
        'minmax(220px, 1fr)',
        'var(--size-column-date)'
      ])
    }
  )
})

describe('Grants and Workflows', () => {
  test.each([
    [grantsBucket, 'Grant', 'worstFetchStatus'],
    [workflowsBucket, 'Workflow', 'fetchStatus']
  ])('one version column, Stored, Status, Received', (bucket, title, fact) => {
    expect(columns(bucket).map(({ label }) => label)).toEqual([
      title,
      'Stored',
      'Status',
      'Received'
    ])
    expect(toVersionColumn(bucket)).toBe('version')
    expect(
      toFactLabel(bucket, bucket.facts.find(({ name }) => name === fact)!)
    ).toBe('Stored')
  })

  test.each([grantsBucket, workflowsBucket])(
    '$id: widths that no row can change, so loading more keeps the columns still',
    (bucket) => {
      expect(columns(bucket).map(({ width }) => width)).toEqual([
        'minmax(220px, 1fr)',
        '160px',
        '128px',
        'var(--size-column-date)'
      ])
    }
  )

  test('the catalogue’s tones, error drawn as danger', () => {
    expect(
      toTone(grantsBucket, 'worstFetchStatus', 'permanent_error', 'error')
    ).toBe('danger')
    expect(toTone(grantsBucket, 'status', 'active', 'success')).toBe('success')
  })

  test('only the grants list puts the stored state’s hint in a tooltip, as the prototype does', () => {
    expect(
      toListColumns(grantsBucket).find(({ key }) => key === 'definition')
        ?.tooltip
    ).toBe(true)
    expect(
      toListColumns(workflowsBucket).find(({ key }) => key === 'definition')
        ?.tooltip
    ).toBe(false)
  })
})

describe('a list GPA has no entry for', () => {
  const unknown: BucketEntry = { ...applicationsBucket, id: 'gas.new' }

  test('is drawn as the catalogue declares it', () => {
    expect(columns(unknown).map(({ label }) => label)).toEqual([
      'Reference',
      'Grant',
      'Status',
      'Created'
    ])
    expect(toTone(unknown, 'status', 'X', undefined)).toBe('neutral')
  })
})

test('every entry is for a list GAS or CW declares', () => {
  expect(Object.keys(cataloguePresentation).sort()).toEqual([
    'cw.cases',
    'cw.inbox',
    'cw.outbox',
    'cw.workflows',
    'gas.applications',
    'gas.grants',
    'gas.inbox',
    'gas.outbox'
  ])
})
