import type {
  ConfigFailed,
  DeadLetters,
  Overview,
  OverviewPart,
  OverviewSourceError,
  TokensExpiring,
  TopError,
  TopErrors
} from './get-overview.use-case.ts'

export const overviewAt = '2026-10-13T15:00:00.000Z'

const windowFrom = '2026-10-12T15:00:00.000Z'

const twoHoursMs = 2 * 60 * 60 * 1000

/** Twelve two-hour windows back to back, ending at the overview's time. */
export const toBars = (counts: number[], capped: boolean[] = []) =>
  counts.map((count, i) => ({
    count,
    capped: capped[i] ?? false,
    from: new Date(Date.parse(windowFrom) + i * twoHoursMs).toISOString(),
    to: new Date(Date.parse(windowFrom) + (i + 1) * twoHoursMs).toISOString()
  }))

const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0)

export const toDeadLetters = (
  service: 'gas' | 'cw',
  counts: number[]
): DeadLetters => ({
  count: sum(counts),
  capped: false,
  bars: toBars(counts),
  lists: (['outbox', 'inbox'] as const).map((box, i) => ({
    box,
    count: i === 0 ? sum(counts.slice(0, 6)) : sum(counts.slice(6)),
    capped: false,
    list: {
      path: `events/${service}/${box}`,
      query: { status: 'DEAD_LETTER', from: windowFrom, to: overviewAt }
    }
  }))
})

export const read = <T>(data: T): OverviewPart<T> => ({
  data,
  sourceError: null
})

export const failed = <T>(
  sourceError: OverviewSourceError
): OverviewPart<T> => ({ data: null, sourceError })

const topError = (
  service: 'gas' | 'cw',
  box: 'outbox' | 'inbox',
  errorKey: string | null,
  event: string,
  count: number,
  lastAt: string
): TopError => ({
  errorKey,
  event: { value: event, label: event },
  count,
  capped: false,
  lastAt,
  list: {
    path: `events/${service}/${box}`,
    query: {
      status: 'DEAD_LETTER',
      ...(errorKey === null ? {} : { error: errorKey }),
      event
    }
  }
})

export const gasTopErrors: TopErrors = {
  entries: [
    topError(
      'gas',
      'inbox',
      'Error: Application with clientRef <v> not found',
      'AgreementStatusUpdated',
      214,
      '2026-10-13T14:53:00.000Z'
    ),
    topError(
      'gas',
      'outbox',
      'Grant <v> version <v> not found',
      'CreateCase',
      96,
      '2026-10-13T14:41:00.000Z'
    ),
    topError(
      'gas',
      'outbox',
      'Request failed with status code <v>',
      'CreateCase',
      41,
      '2026-10-12T16:02:00.000Z'
    ),
    topError(
      'gas',
      'outbox',
      'No error recorded',
      'CreateCase',
      23,
      '2026-10-12T11:17:00.000Z'
    ),
    topError(
      'gas',
      'inbox',
      'data.status must be equal to one of the allowed values',
      'CaseStatusUpdated',
      14,
      '2026-10-13T09:40:00.000Z'
    )
  ],
  more: true,
  complete: true
}

export const cwTopErrors: TopErrors = {
  entries: [
    topError(
      'cw',
      'inbox',
      'Status <v> is not a status of workflow <v>',
      'UpdateCaseStatus',
      18,
      '2026-10-13T15:04:00.000Z'
    ),
    topError(
      'cw',
      'outbox',
      'Topic <v> not found',
      'CaseStatusUpdated',
      6,
      '2026-10-12T16:10:00.000Z'
    )
  ],
  more: false,
  complete: true
}

export const gasConfigFailed: ConfigFailed = {
  versions: [
    {
      code: 'frps-private-beta',
      version: '1.11.0',
      definition: 'permanent_error',
      receivedAt: '2026-10-13T09:12:00.000Z'
    }
  ],
  more: false
}

export const cwConfigFailed: ConfigFailed = {
  versions: [
    {
      code: 'woodland',
      version: '2.1.0',
      definition: 'transient_error',
      receivedAt: null
    }
  ],
  more: false
}

const token = (
  clientId: string,
  status: 'ACTIVE' | 'EXPIRED',
  expiresAt: string
) => ({
  tokenId: `${clientId}-token`,
  clientId,
  tokenHint: 'ab12',
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'Ada Lovelace',
  expiresAt,
  revokedAt: null,
  revokedBy: null,
  inUse: false
})

export const gasTokensExpiring: TokensExpiring = {
  withinDays: 30,
  tokens: [token('grants-ui', 'ACTIVE', '2026-10-20T22:59:59.000Z')]
}

export const cwTokensExpiring: TokensExpiring = {
  withinDays: 30,
  tokens: [token('fg-gas-backend', 'EXPIRED', '2026-10-01T22:59:59.000Z')]
}

export const gasCounts = [3, 1, 0, 2, 0, 0, 1, 0, 4, 18, 26, 11]

export const cwCounts = [0, 1, 0, 0, 0, 0, 0, 0, 1, 3, 5, 2]

/** Something to look at in every part. */
export const needsAttention: Overview = {
  at: overviewAt,
  window: { from: windowFrom, to: overviewAt },
  countCap: 10_000,
  deadLetters: {
    gas: read(toDeadLetters('gas', gasCounts)),
    cw: read(toDeadLetters('cw', cwCounts))
  },
  topErrors: { gas: read(gasTopErrors), cw: read(cwTopErrors) },
  configFailed: { gas: read(gasConfigFailed), cw: read(cwConfigFailed) },
  tokensExpiring: { gas: read(gasTokensExpiring), cw: read(cwTokensExpiring) }
}

const zeros = Array.from({ length: 12 }, () => 0)

const noErrors: TopErrors = { entries: [], more: false, complete: true }

/** Every part read, and nothing to look at. */
export const allClear: Overview = {
  ...needsAttention,
  deadLetters: {
    gas: read(toDeadLetters('gas', zeros)),
    cw: read(toDeadLetters('cw', zeros))
  },
  topErrors: { gas: read(noErrors), cw: read(noErrors) },
  configFailed: {
    gas: read({ versions: [], more: false }),
    cw: read({ versions: [], more: false })
  },
  tokensExpiring: {
    gas: read({ withinDays: 30, tokens: [] }),
    cw: read({ withinDays: 30, tokens: [] })
  }
}
