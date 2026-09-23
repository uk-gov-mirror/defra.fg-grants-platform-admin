import { getFromGas, postToGas } from '../../common/gas.ts'
import type {
  Event,
  EventWithAttempts,
  EventDetail,
  EventKey,
  EventRow,
  EventsPage,
  EventsPageResponse,
  ServiceFilter,
  StatusFilter
} from './events.repository.ts'
import {
  editPayload,
  findEvent,
  findEventsPage,
  purgeEvent,
  redriveEvent,
  toEventKeyPath
} from './events.repository.ts'

vi.mock(import('../../common/gas.ts'))

const base: Event = {
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b',
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  createdAt: '2026-06-16T10:00:00.000Z'
}

const withAttempts: EventWithAttempts = {
  ...base,
  attempts: '5/5',
  targetTopic: 'gas__sns__update_case_status_fifo',
  lastError: {
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events',
    at: '2026-06-16T10:16:05.000Z'
  }
}

const row: EventRow = {
  ...base,
  latency: null,
  latencyTitle: 'Queued to delivered to SNS'
}

const page: EventsPage = {
  events: [row],
  pagination: {
    endCursor: 'END',
    hasNextPage: true
  },
  sourceErrors: []
}

const statuses: StatusFilter[] = [
  {
    value: 'PUBLISHED',
    label: 'Queued',
    explainer: 'Queued, not yet claimed'
  },
  { value: 'PROCESSING', label: 'Processing', explainer: 'Claimed, in flight' },
  { value: 'FAILED', label: 'Failed', explainer: 'Awaiting automatic retry' },
  {
    value: 'RESUBMITTED',
    label: 'Resubmitted',
    explainer: 'Queued for another retry cycle'
  },
  {
    value: 'COMPLETED',
    label: 'Completed',
    explainer: 'Processed successfully'
  },
  {
    value: 'DEAD_LETTER',
    label: 'Dead letter',
    explainer: 'Failed all retry attempts; needs a redrive'
  }
]

const services: ServiceFilter[] = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'CW-BE' }
]

const composed: EventsPageResponse = {
  ...page,
  statuses,
  services,
  counts: {
    PUBLISHED: 12,
    PROCESSING: 3,
    FAILED: 1,
    RESUBMITTED: 0,
    COMPLETED: 236196,
    DEAD_LETTER: 7064
  },
  breakdown: { groups: [] },
  sectionErrors: []
}

describe('findEventsPage query building', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(composed)
  })

  test('reads the composed page from fg-gas-backend', async () => {
    await findEventsPage({ cursor: 'eyJ2IjoxfQ' })

    expect(getFromGas).toHaveBeenCalledTimes(1)
    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?cursor=eyJ2IjoxfQ'
    )
  })

  test('asks for the unfiltered page when given no parameters', async () => {
    await findEventsPage({})

    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/events/page')
  })

  test('forwards the cursor, status and service', async () => {
    await findEventsPage({
      cursor: 'eyJ2IjoxfQ',
      status: 'DEAD_LETTER',
      service: 'gas'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?cursor=eyJ2IjoxfQ&status=DEAD_LETTER&service=gas'
    )
  })

  test('leaves out a parameter that was not given', async () => {
    await findEventsPage({ cursor: undefined, status: 'FAILED' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?status=FAILED'
    )
  })

  test('forwards a status the endpoint may reject', async () => {
    await findEventsPage({ status: 'BOGUS' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?status=BOGUS'
    )
  })

  test('escapes a cursor containing url characters', async () => {
    await findEventsPage({ cursor: 'a+b/c=' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?cursor=a%2Bb%2Fc%3D'
    )
  })

  test('escapes a status containing url characters', async () => {
    await findEventsPage({ status: 'a&b=c' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?status=a%26b%3Dc'
    )
  })

  test('forwards both ends of the range as the endpoint takes them', async () => {
    await findEventsPage({
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?from=2026-06-16T09%3A00%3A00.000Z&to=2026-06-16T10%3A00%3A00.000Z'
    )
  })

  test('forwards one end of the range without inventing the other', async () => {
    await findEventsPage({ from: '2026-06-16T09:00:00.000Z' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?from=2026-06-16T09%3A00%3A00.000Z'
    )
  })

  test('returns the rows the backend answers with', async () => {
    const { events, pagination } = await findEventsPage({})

    expect({ events, pagination }).toEqual({
      events: page.events,
      pagination: page.pagination
    })
  })
})

describe('findEventsPage', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(composed)
  })

  test('forwards every filter the page is holding', async () => {
    await findEventsPage({
      cursor: 'eyJ2IjoxfQ',
      status: 'DEAD_LETTER',
      service: 'gas',
      q: 'gld-9b2',
      error: 'boom',
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })

    const [url] = vi.mocked(getFromGas).mock.calls[0]

    expect(url).toContain('/grant-admin/events/page?')
    for (const part of [
      'cursor=eyJ2IjoxfQ',
      'status=DEAD_LETTER',
      'service=gas',
      'q=gld-9b2',
      'error=boom',
      'from=2026-06-16T09%3A00%3A00.000Z',
      'to=2026-06-16T10%3A00%3A00.000Z'
    ]) {
      expect(url).toContain(part)
    }
  })

  test('returns every section the backend composed', async () => {
    await expect(findEventsPage({})).resolves.toEqual(composed)
  })

  test('carries a null section and the reason it is null', async () => {
    vi.mocked(getFromGas).mockResolvedValue({
      ...composed,
      counts: null,
      sectionErrors: [{ section: 'counts', message: 'Bad Gateway' }]
    })

    const { counts, sectionErrors } = await findEventsPage({})

    expect(counts).toBeNull()
    expect(sectionErrors).toEqual([
      { section: 'counts', message: 'Bad Gateway' }
    ])
  })
})

const detail: EventDetail = {
  ...withAttempts,
  attemptHistory: [
    {
      at: '2026-06-16T10:16:05.000Z',
      name: 'MongoServerError',
      message: 'E11000 duplicate key error collection: gas.events',
      stack: null
    }
  ],
  payload: { id: '3f2c1a0e', data: { caseRef: 'GLD-9B2' } },
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null
}

const key: EventKey = {
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b'
}

describe('toEventKeyPath', () => {
  test('joins the three segments, escaping each one', () => {
    expect(toEventKeyPath(key)).toBe('gas/outbox/665f1c2e9a1b2c3d4e5f6a7b')
  })

  test('leaves a hostile value as a single segment', () => {
    expect(
      toEventKeyPath({
        service: 'gas/../admin',
        box: 'in box',
        id: 'a?b'
      } as unknown as EventKey)
    ).toBe('gas%2F..%2Fadmin/in%20box/a%3Fb')
  })
})

describe('findEvent', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(detail)
  })

  test('reads one event from fg-gas-backend', async () => {
    await findEvent(key)

    expect(getFromGas).toHaveBeenCalledTimes(1)
    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b'
    )
  })

  test('returns every section the backend composed', async () => {
    await expect(findEvent(key)).resolves.toEqual(detail)
  })

  test('escapes every segment of the path', async () => {
    await findEvent({
      service: 'gas/../admin',
      box: 'in box',
      id: 'a?b'
    } as unknown as EventKey)

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas%2F..%2Fadmin/in%20box/a%3Fb'
    )
  })
})

describe('redriveEvent', () => {
  beforeEach(() => {
    vi.mocked(postToGas).mockResolvedValue(Buffer.alloc(0))
  })

  test('posts the redrive to fg-gas-backend', async () => {
    await redriveEvent(key)

    expect(postToGas).toHaveBeenCalledTimes(1)
    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b/redrive',
      { actor: undefined }
    )
  })

  test('resolves with nothing on the empty 204 the backend answers with', async () => {
    await expect(redriveEvent(key)).resolves.toBeUndefined()
  })

  test('escapes every segment of the path', async () => {
    await redriveEvent({
      service: 'a/b',
      box: 'c d',
      id: 'e?f'
    } as unknown as EventKey)

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/a%2Fb/c%20d/e%3Ff/redrive',
      { actor: undefined }
    )
  })
})

describe('purgeEvent', () => {
  beforeEach(() => {
    vi.mocked(postToGas).mockResolvedValue(Buffer.alloc(0))
  })

  test('posts the reason and the note to fg-gas-backend, naming the operator', async () => {
    await purgeEvent(
      key,
      { reasonCode: 'BROKEN_PAYLOAD', note: 'sheetId is a number' },
      'Ada Lovelace'
    )

    expect(postToGas).toHaveBeenCalledTimes(1)
    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b/purge',
      {
        payload: {
          reasonCode: 'BROKEN_PAYLOAD',
          note: 'sheetId is a number'
        },
        actor: 'Ada Lovelace'
      }
    )
  })

  test('leaves an empty note out of the body altogether', async () => {
    await purgeEvent(key, { reasonCode: 'SENT_IN_ERROR', note: '' })

    expect(postToGas).toHaveBeenCalledWith(expect.any(String), {
      payload: { reasonCode: 'SENT_IN_ERROR' },
      actor: undefined
    })
  })

  test('resolves with nothing, reading nothing out of the answer', async () => {
    await expect(
      purgeEvent(key, { reasonCode: 'OTHER', note: 'why' })
    ).resolves.toBeUndefined()
  })

  test('escapes every segment of the path', async () => {
    await purgeEvent(
      { service: 'a/b', box: 'c d', id: 'e?f' } as unknown as EventKey,
      { reasonCode: 'OTHER', note: 'why' }
    )

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/a%2Fb/c%20d/e%3Ff/purge',
      expect.any(Object)
    )
  })
})

describe('editPayload', () => {
  const edit = {
    payload: { sheetId: '12345' },
    note: 'sheetId arrives as a number',
    revision: 2
  }

  beforeEach(() => {
    vi.mocked(postToGas).mockResolvedValue({
      payloadRevision: 3,
      changedPaths: ['/sheetId'],
      changedPathsTruncated: false
    })
  })

  test('posts the payload, the note and the revision it was made against, naming the operator', async () => {
    await editPayload(key, edit, 'Ada Lovelace')

    expect(postToGas).toHaveBeenCalledTimes(1)
    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b/payload',
      {
        payload: {
          payload: { sheetId: '12345' },
          note: 'sheetId arrives as a number',
          revision: 2
        },
        actor: 'Ada Lovelace'
      }
    )
  })

  test('resolves with nothing, reading nothing out of the answer', async () => {
    await expect(editPayload(key, edit)).resolves.toBeUndefined()
  })

  test('escapes every segment of the path', async () => {
    await editPayload(
      { service: 'a/b', box: 'c d', id: 'e?f' } as unknown as EventKey,
      edit
    )

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/a%2Fb/c%20d/e%3Ff/payload',
      expect.any(Object)
    )
  })
})

describe('findEventsPage with a failure filter', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(composed)
  })

  test('forwards the whole error message', async () => {
    await findEventsPage({
      status: 'DEAD_LETTER',
      error: 'E11000 duplicate key error collection: gas.events index: id_1'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?status=DEAD_LETTER&error=E11000+duplicate+key+error+collection%3A+gas.events+index%3A+id_1'
    )
  })

  test('escapes a message containing url characters', async () => {
    await findEventsPage({ error: 'a&b=c' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?error=a%26b%3Dc'
    )
  })
})

describe('redriveEvent naming the operator', () => {
  beforeEach(() => {
    vi.mocked(postToGas).mockResolvedValue(Buffer.alloc(0))
  })

  test('sends the actor with the write', async () => {
    await redriveEvent(key, 'Ada Lovelace')

    expect(postToGas).toHaveBeenCalledWith(expect.any(String), {
      actor: 'Ada Lovelace'
    })
  })
})
