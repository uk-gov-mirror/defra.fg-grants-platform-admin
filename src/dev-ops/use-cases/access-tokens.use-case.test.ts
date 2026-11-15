import Boom from '@hapi/boom'

import { logger } from '../../common/logger.ts'
import type {
  ListedToken,
  TokenKey
} from '../repositories/clients.repository.ts'
import {
  changeTokenExpiry,
  deleteToken,
  issueToken,
  listTokens,
  revokeToken,
  rotateToken
} from '../repositories/clients.repository.ts'
import {
  changeTokenExpiryUseCase,
  deleteAccessTokenUseCase,
  issueAccessTokenUseCase,
  listAccessTokensUseCase,
  revokeAccessTokenUseCase,
  rotateAccessTokenUseCase
} from './access-tokens.use-case.ts'
import { generateToken } from './generate-token.ts'

vi.mock(import('../repositories/clients.repository.ts'))
vi.mock(import('../../common/logger.ts'))
vi.mock(import('./generate-token.ts'))

const raw = 'raw-token-value-that-must-stay-in-memory-x7Qa'
const hash = 'f'.repeat(64)

const token: ListedToken = {
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
  stored: { _id: { $oid: '6650c1f2a9e4b1d07c20bd91' }, id: 'a1b••••••f2c' }
}

const key: TokenKey = {
  service: 'gas',
  clientId: 'grants-ui',
  tokenId: token.tokenId
}

/** As @hapi/wreck rejects for a non-2xx answer. */
const responseError = (statusCode: number, body: object = {}) =>
  new Boom.Boom(`Response Error: ${statusCode}`, {
    statusCode,
    data: { isResponseError: true, payload: body }
  })

/** Hapi's answer for a path it has no route for. */
const noRoute = { statusCode: 404, error: 'Not Found', message: 'Not Found' }

/** GAS's Boom for a token or client it hasn't got, with the code it adds. */
const notFoundBody = (errorCode: string) => ({
  statusCode: 404,
  error: 'Not Found',
  message: 'CW-BE has no such client or token',
  errorCode
})

/** A 5xx with no code, as Hapi sends GAS's Boom: only a 500 has its message hidden. */
const gasError = (statusCode: number, error: string, message: string) => ({
  statusCode,
  error,
  message
})

/** As @hapi/wreck rejects when no connection could be made. */
const connectionError = (code: string) =>
  Boom.badGateway(
    'Client request error',
    Object.assign(new Error(`connect ${code}`), { code })
  )

const timeout = () => Boom.gatewayTimeout('Client request timeout')

const loggedText = () =>
  JSON.stringify([
    vi.mocked(logger.warn).mock.calls,
    vi.mocked(logger.error).mock.calls
  ])

const failures = [
  [
    'a refusal, with its error code',
    responseError(409, { errorCode: 'API_TOKEN_IN_USE' }),
    { outcome: 'refused', statusCode: 409, errorCode: 'API_TOKEN_IN_USE' }
  ],
  [
    'a refusal with no error code',
    responseError(403),
    { outcome: 'refused', statusCode: 403, errorCode: null }
  ],
  [
    'a 404 for a token GAS hasn’t got',
    responseError(404, notFoundBody('API_TOKEN_NOT_FOUND')),
    { outcome: 'refused', statusCode: 404, errorCode: 'API_TOKEN_NOT_FOUND' }
  ],
  [
    'a 404 for a client GAS hasn’t got',
    responseError(404, notFoundBody('API_CLIENT_NOT_FOUND')),
    { outcome: 'refused', statusCode: 404, errorCode: 'API_CLIENT_NOT_FOUND' }
  ],
  [
    'a 404 with no error code: a GAS with no token routes',
    responseError(404, noRoute),
    { outcome: 'not-offered' }
  ],
  [
    'a connection that was never made',
    connectionError('ECONNREFUSED'),
    { outcome: 'unreachable' }
  ],
  [
    'a host that does not resolve',
    connectionError('ENOTFOUND'),
    { outcome: 'unreachable' }
  ],
  [
    'GAS answering 503 CW_UNREACHABLE: it could not reach Caseworking at all',
    responseError(503, { errorCode: 'CW_UNREACHABLE' }),
    { outcome: 'unreachable', errorCode: 'CW_UNREACHABLE' }
  ],
  [
    'a 503 without that code, as from a proxy in front of GAS, which may have been sent on',
    responseError(
      503,
      gasError(503, 'Service Unavailable', 'Service Unavailable')
    ),
    { outcome: 'errored' }
  ],
  ['a timeout here', timeout(), { outcome: 'unknown', gasSilent: true }],
  [
    'a 500',
    responseError(
      500,
      gasError(
        500,
        'Internal Server Error',
        'An internal server error occurred'
      )
    ),
    { outcome: 'errored' }
  ],
  [
    'a 502 from GAS, as when CW has no client routes',
    responseError(
      502,
      gasError(502, 'Bad Gateway', 'CW-BE has no client routes')
    ),
    { outcome: 'errored' }
  ],
  [
    'a 504 from GAS: CW didn’t answer it in time',
    responseError(
      504,
      gasError(
        504,
        'Gateway Time-out',
        'CW-BE did not answer in time for clients'
      )
    ),
    { outcome: 'unknown' }
  ],
  [
    'a read that timed out',
    Boom.clientTimeout(),
    { outcome: 'unknown', gasSilent: true }
  ],
  [
    'a connection dropped mid-request',
    connectionError('ECONNRESET'),
    { outcome: 'unknown', gasSilent: true }
  ],
  ['anything else', new Error('boom'), { outcome: 'errored' }]
] as const

describe('listAccessTokensUseCase', () => {
  test('answers the tokens GAS lists', async () => {
    vi.mocked(listTokens).mockResolvedValue([token])

    await expect(listAccessTokensUseCase('cw')).resolves.toEqual({
      outcome: 'done',
      tokens: [token]
    })
    expect(listTokens).toHaveBeenCalledWith('cw')
  })

  test.each(failures)(
    'answers %s as the failure, so the page can say who didn’t answer',
    async (_name, error, expected) => {
      vi.mocked(listTokens).mockRejectedValue(error)

      await expect(listAccessTokensUseCase('gas')).resolves.toEqual(expected)
    }
  )

  test('answers CW not reached when GAS says so', async () => {
    vi.mocked(listTokens).mockRejectedValue(
      responseError(502, { errorCode: 'CW_UNREACHABLE' })
    )

    await expect(listAccessTokensUseCase('cw')).resolves.toEqual({
      outcome: 'unreachable',
      errorCode: 'CW_UNREACHABLE'
    })
  })
})

describe('issueAccessTokenUseCase', () => {
  beforeEach(() => {
    vi.mocked(generateToken).mockReturnValue({ raw, hash, hint: 'x7Qa' })
    vi.mocked(listTokens).mockResolvedValue([token])
    vi.mocked(issueToken).mockResolvedValue(token)
  })

  test('sends GAS the hash and hint only, and keeps the raw token for the reveal', async () => {
    await expect(
      issueAccessTokenUseCase('gas', 'grants-ui', {
        expiresAt: '2027-02-02T13:50:00.000Z',
        confirmed: true
      })
    ).resolves.toEqual({ outcome: 'issued', raw, token })

    expect(issueToken).toHaveBeenCalledWith(
      'gas',
      'grants-ui',
      { tokenHash: hash, tokenHint: 'x7Qa' },
      { expiresAt: '2027-02-02T13:50:00.000Z', newClient: false }
    )
    expect(JSON.stringify(vi.mocked(issueToken).mock.calls)).not.toContain(raw)
  })

  test('creates the client when no row has its name', async () => {
    await issueAccessTokenUseCase('cw', 'new-service', {
      expiresAt: null,
      confirmed: false
    })

    expect(issueToken).toHaveBeenCalledWith(
      'cw',
      'new-service',
      expect.anything(),
      { expiresAt: null, newClient: true }
    )
  })

  test('issues nothing for a client with active tokens until confirmed, and says how many it has', async () => {
    vi.mocked(listTokens).mockResolvedValue([
      token,
      { ...token, tokenId: '6650c1f2a9e4b1d07c20bd92' },
      { ...token, tokenId: '6650c1f2a9e4b1d07c20bd93', status: 'REVOKED' }
    ])

    await expect(
      issueAccessTokenUseCase('gas', 'grants-ui', {
        expiresAt: null,
        confirmed: false
      })
    ).resolves.toEqual({ outcome: 'has-active', active: 2 })
    expect(issueToken).not.toHaveBeenCalled()
  })

  test('issues for a client whose tokens have all stopped working without asking', async () => {
    vi.mocked(listTokens).mockResolvedValue([{ ...token, status: 'EXPIRED' }])

    await expect(
      issueAccessTokenUseCase('gas', 'grants-ui', {
        expiresAt: null,
        confirmed: false
      })
    ).resolves.toMatchObject({ outcome: 'issued' })
    expect(issueToken).toHaveBeenCalledWith(
      'gas',
      'grants-ui',
      expect.anything(),
      { expiresAt: null, newClient: false }
    )
  })

  test('issues nothing when the list cannot be read', async () => {
    vi.mocked(listTokens).mockRejectedValue(timeout())

    await expect(
      issueAccessTokenUseCase('gas', 'grants-ui', {
        expiresAt: null,
        confirmed: true
      })
    ).resolves.toEqual({ outcome: 'unchecked' })
    expect(issueToken).not.toHaveBeenCalled()
  })

  test('says GAS offers no tokens when the list has no route, and issues nothing', async () => {
    vi.mocked(listTokens).mockRejectedValue(responseError(404, noRoute))

    await expect(
      issueAccessTokenUseCase('gas', 'grants-ui', {
        expiresAt: null,
        confirmed: true
      })
    ).resolves.toEqual({ outcome: 'not-offered' })
    expect(issueToken).not.toHaveBeenCalled()
  })

  test('issues nothing when GAS answers the list with an error of its own', async () => {
    vi.mocked(listTokens).mockRejectedValue(
      responseError(
        502,
        gasError(502, 'Bad Gateway', 'CW-BE has no client routes')
      )
    )

    await expect(
      issueAccessTokenUseCase('gas', 'grants-ui', {
        expiresAt: null,
        confirmed: true
      })
    ).resolves.toEqual({ outcome: 'unchecked' })
    expect(issueToken).not.toHaveBeenCalled()
  })

  test.each(failures)(
    'reports %s and drops the raw token',
    async (_name, error, expected) => {
      vi.mocked(issueToken).mockRejectedValue(error)

      const result = await issueAccessTokenUseCase('gas', 'grants-ui', {
        expiresAt: null,
        confirmed: true
      })

      expect(result).toEqual(expected)
      expect(JSON.stringify(result)).not.toContain(raw)
    }
  )

  test('logs no raw token, hash or hint', async () => {
    vi.mocked(issueToken).mockRejectedValue(responseError(500))

    await issueAccessTokenUseCase('gas', 'grants-ui', {
      expiresAt: null,
      confirmed: true
    })

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(loggedText()).not.toContain(raw)
    expect(loggedText()).not.toContain(hash)
    expect(loggedText()).not.toContain('x7Qa')
  })
})

describe('rotateAccessTokenUseCase', () => {
  beforeEach(() => {
    vi.mocked(generateToken).mockReturnValue({ raw, hash, hint: 'x7Qa' })
    vi.mocked(rotateToken).mockResolvedValue(token)
  })

  test('sends the new hash and hint with the overlap, keeping the raw token for the reveal', async () => {
    await expect(rotateAccessTokenUseCase(key, '24h')).resolves.toEqual({
      outcome: 'issued',
      raw,
      token
    })
    expect(rotateToken).toHaveBeenCalledWith(
      key,
      { tokenHash: hash, tokenHint: 'x7Qa' },
      '24h'
    )
  })

  test.each(failures)(
    'reports %s and drops the raw token',
    async (_name, error, expected) => {
      vi.mocked(rotateToken).mockRejectedValue(error)

      const result = await rotateAccessTokenUseCase(key, 'none')

      expect(result).toEqual(expected)
      expect(loggedText()).not.toContain(raw)
      expect(loggedText()).not.toContain(hash)
      expect(loggedText()).not.toContain('x7Qa')
    }
  )
})

describe('changeTokenExpiryUseCase', () => {
  test('answers the changed token', async () => {
    vi.mocked(changeTokenExpiry).mockResolvedValue(token)

    await expect(changeTokenExpiryUseCase(key, null)).resolves.toEqual({
      outcome: 'done',
      token
    })
    expect(changeTokenExpiry).toHaveBeenCalledWith(key, null)
  })

  test.each(failures)('reports %s', async (_name, error, expected) => {
    vi.mocked(changeTokenExpiry).mockRejectedValue(error)

    await expect(changeTokenExpiryUseCase(key, null)).resolves.toEqual(expected)
  })
})

describe('revokeAccessTokenUseCase', () => {
  test('revokes the token at this address', async () => {
    vi.mocked(revokeToken).mockResolvedValue(undefined)

    await expect(revokeAccessTokenUseCase(key)).resolves.toEqual({
      outcome: 'done'
    })
    expect(revokeToken).toHaveBeenCalledWith(key)
  })

  test.each(failures)('reports %s', async (_name, error, expected) => {
    vi.mocked(revokeToken).mockRejectedValue(error)

    await expect(revokeAccessTokenUseCase(key)).resolves.toEqual(expected)
  })

  test('warns, rather than errs, on a refusal, naming the token by its address', async () => {
    vi.mocked(revokeToken).mockRejectedValue(
      responseError(409, { errorCode: 'API_TOKEN_IN_USE' })
    )

    await revokeAccessTokenUseCase(key)

    expect(logger.warn).toHaveBeenCalledWith(
      `Did not revoke token gas/grants-ui/${token.tokenId}: 409 API_TOKEN_IN_USE`
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('warns, rather than errs, when GAS has no token routes', async () => {
    vi.mocked(revokeToken).mockRejectedValue(responseError(404, noRoute))

    await revokeAccessTokenUseCase(key)

    expect(logger.warn).toHaveBeenCalledWith(
      `Did not revoke token gas/grants-ui/${token.tokenId}: fg-gas-backend has no access token routes`
    )
    expect(logger.error).not.toHaveBeenCalled()
  })
})

describe('deleteAccessTokenUseCase', () => {
  test('deletes the token at this address', async () => {
    vi.mocked(deleteToken).mockResolvedValue(undefined)

    await expect(deleteAccessTokenUseCase(key)).resolves.toEqual({
      outcome: 'done'
    })
    expect(deleteToken).toHaveBeenCalledWith(key)
  })

  test.each(failures)('reports %s', async (_name, error, expected) => {
    vi.mocked(deleteToken).mockRejectedValue(error)

    await expect(deleteAccessTokenUseCase(key)).resolves.toEqual(expected)
  })
})
