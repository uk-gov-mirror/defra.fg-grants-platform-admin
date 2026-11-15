import type { ListedToken } from '../use-cases/access-tokens.use-case.ts'
import {
  isExpiringSoon,
  toActions,
  toCompareTokens,
  toTokenRows,
  toTokenState,
  tokenStates
} from './access-token-rows.ts'
import { serviceWords } from './access-token-services.ts'

const now = new Date('2026-11-04T13:50:00.000Z')
const hour = 3_600_000
const day = 24 * hour

const after = (ms: number): string => new Date(now.getTime() + ms).toISOString()

const token = (fields: Partial<ListedToken> = {}): ListedToken => ({
  tokenId: '6650c1f2a9e4b1d07c20bd91',
  clientId: 'grants-ui',
  tokenHint: 'x7Qa',
  status: 'ACTIVE',
  createdAt: '2026-11-02T10:00:00.000Z',
  createdBy: 'Alex Operator',
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  inUse: false,
  stored: { _id: { $oid: fields.tokenId ?? '6650c1f2a9e4b1d07c20bd91' } },
  ...fields
})

const context = { now, words: serviceWords.gas }

describe('toTokenState', () => {
  test.each([
    ['active with no expiry', token(), 'active'],
    [
      'active, 29 days 23 hours left',
      token({ expiresAt: after(30 * day - hour) }),
      'expiring'
    ],
    [
      'active, exactly 30 days left',
      token({ expiresAt: after(30 * day) }),
      'active'
    ],
    ['active, under a day left', token({ expiresAt: after(hour) }), 'expiring'],
    [
      'expired',
      token({ status: 'EXPIRED', expiresAt: after(-day) }),
      'expired'
    ],
    ['revoked', token({ status: 'REVOKED', expiresAt: after(-day) }), 'revoked']
  ] as const)('%s is %s', (_name, given, state) => {
    expect(toTokenState(given, now)).toBe(state)
  })

  test('the Overview reads the same 30-day rule', () => {
    expect(isExpiringSoon(token({ expiresAt: after(30 * day - 1) }), now)).toBe(
      true
    )
    expect(isExpiringSoon(token({ expiresAt: after(30 * day) }), now)).toBe(
      false
    )
    expect(
      isExpiringSoon(token({ status: 'EXPIRED', expiresAt: after(-1) }), now)
    ).toBe(false)
  })

  test('each state has the prototype’s word and tone', () => {
    expect(tokenStates).toEqual({
      active: { text: 'Active', tone: 'success' },
      expiring: { text: 'Expiring soon', tone: 'warning' },
      expired: { text: 'Expired', tone: 'neutral' },
      revoked: { text: 'Revoked', tone: 'danger' }
    })
  })
})

describe('toActions', () => {
  test.each([
    ['active', { rotate: true, expiry: true, revoke: true, delete: false }],
    ['expiring', { rotate: true, expiry: true, revoke: true, delete: false }],
    ['expired', { rotate: false, expiry: true, revoke: false, delete: true }],
    ['revoked', { rotate: false, expiry: false, revoke: false, delete: true }]
  ] as const)(
    'a %s token has the actions the services allow it',
    (state, actions) => {
      expect(toActions(token(), state)).toEqual(actions)
    }
  )

  test('a row with no valid client ID has none: no route can address it', () => {
    expect(toActions(token({ clientId: null }), 'active')).toEqual({
      rotate: false,
      expiry: false,
      revoke: false,
      delete: false
    })
  })
})

describe('toCompareTokens', () => {
  test('sorts by client, then expiring, working and dead, then newest; unnamed rows last', () => {
    const rows = [
      token({ tokenId: 'a', clientId: null }),
      token({ tokenId: 'b', status: 'REVOKED' }),
      token({ tokenId: 'c', createdAt: '2026-10-01T00:00:00.000Z' }),
      token({ tokenId: 'd' }),
      token({ tokenId: 'e', expiresAt: after(day) }),
      token({ tokenId: 'f', clientId: 'apply' })
    ]

    expect(
      rows.toSorted(toCompareTokens(now)).map(({ tokenId }) => tokenId)
    ).toEqual(['f', 'e', 'd', 'c', 'b', 'a'])
  })
})

describe('a token’s expiry', () => {
  const expiresOn = (expiresAt: string) =>
    toTokenRows([token({ expiresAt })], context)[0].expires

  test('writes the UK day, and its title the second and zone the token stops at', () => {
    expect(expiresOn('2027-02-04T23:59:59.000Z')).toEqual({
      datetime: '2027-02-04T23:59:59Z',
      text: '4\u00a0Feb 2027',
      title: '4 Feb 2027 23:59:59 GMT'
    })
  })

  test('in summer the UK end of day is 22:59:59 UTC, written as its UK day', () => {
    expect(expiresOn('2027-07-04T22:59:59.000Z')).toEqual({
      datetime: '2027-07-04T22:59:59Z',
      text: '4\u00a0Jul 2027',
      title: '4 Jul 2027 23:59:59 BST'
    })
  })

  test('an instant in the first hour of a UK summer day is that UK day, not the UTC day before', () => {
    expect(expiresOn('2027-05-30T23:59:59.000Z')).toEqual({
      datetime: '2027-05-30T23:59:59Z',
      text: '31\u00a0May 2027',
      title: '31 May 2027 00:59:59 BST'
    })
  })
})

describe('toTokenRows', () => {
  test('carries what the list and the drawer show', () => {
    const [row] = toTokenRows(
      [token({ expiresAt: '2027-02-04T23:59:59.000Z', inUse: true })],
      context
    )

    expect(row).toMatchObject({
      tokenId: '6650c1f2a9e4b1d07c20bd91',
      clientId: 'grants-ui',
      hint: 'x7Qa',
      state: 'active',
      status: { text: 'Active', tone: 'success' },
      expires: { text: '4\u00a0Feb 2027', title: '4 Feb 2027 23:59:59 GMT' },
      inUse: true,
      revokeOff: 'Dev Ops is calling GAS with this token. Rotate it instead.'
    })
    expect(JSON.parse(row.document)).toEqual({
      _id: { $oid: '6650c1f2a9e4b1d07c20bd91' }
    })
  })

  test('a token that never expires has no time, and only the token in use has Revoke off', () => {
    const [row] = toTokenRows([token()], context)

    expect(row.expires).toBeNull()
    expect(row.revokeOff).toBeNull()
  })

  test('on CW, the token in use is the one GAS calls with', () => {
    const [row] = toTokenRows([token({ inUse: true })], {
      ...context,
      words: serviceWords.cw
    })

    expect(row.revokeOff).toBe(
      'GAS is calling CW with this token. Rotate it instead.'
    )
  })
})
