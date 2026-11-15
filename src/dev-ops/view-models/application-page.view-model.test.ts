import type { NamedApplicationPage } from './application-page.view-model.ts'
import { toApplicationPage } from './application-page.view-model.ts'
import { catalogue } from '../use-cases/test-fixtures.ts'
import { toTimes } from './times.ts'

const page: NamedApplicationPage = {
  header: {
    clientRef: 'a1',
    code: 'woodland',
    position: {
      phase: 'PHASE_PRE_AWARD',
      stage: null,
      status: 'STATUS_RECEIVED'
    },
    counterpart: { exists: true },
    fetchedAt: '2026-10-13T15:00:00.000Z'
  },
  overview: {
    code: 'woodland',
    originalConfigVersion: null,
    currentConfigVersion: '1.0.0',
    submittedAt: '2026-10-13T14:04:09.000Z',
    createdAt: '2026-10-13T14:04:09.000Z',
    updatedAt: '2026-10-13T14:04:59.000Z',
    identifiers: { sbi: null, frn: null, crn: null },
    series: null,
    storedBytes: null
  },
  sourceErrors: [],
  sectionErrors: [],
  names: null
}

const options = { from: '', times: toTimes('utc'), catalogue }

describe('toApplicationPage', () => {
  test('reads only the open tab, with the alert on Overview alone', () => {
    const events = toApplicationPage(
      { ...page, overview: undefined, events: { rows: [], more: false } },
      'events',
      options
    )

    expect(events.overview).toBeNull()
    expect(events.raw).toBeNull()
    expect(events.alert).toBeNull()
    expect(events.events?.kind).toBe('table')
  })

  test('hides Updated when it reads the same as Submitted', () => {
    const { overview } = toApplicationPage(page, 'overview', options)

    expect(overview?.kind === 'shown' && overview.details.updated).toBeNull()
  })

  test('names the status readably without the definition, so every tab says it', () => {
    expect(toApplicationPage(page, 'raw', options).status).toBe('Received')
  })

  test('goes back to its own list when opened from none', () => {
    expect(toApplicationPage(page, 'overview', options).backHref).toBe(
      '/dev-ops/applications'
    )
  })
})
