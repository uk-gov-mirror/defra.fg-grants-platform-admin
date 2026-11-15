import Boom from '@hapi/boom'

import { logger } from '../../common/logger.ts'
import { getOverview } from '../repositories/overview.repository.ts'
import { getOverviewUseCase } from './get-overview.use-case.ts'
import { needsAttention } from './overview-fixtures.ts'

vi.mock(import('../repositories/overview.repository.ts'))
vi.mock(import('../../common/logger.ts'))

/** As @hapi/wreck rejects for a non-2xx answer. */
const responseError = (statusCode: number, body: object = {}) =>
  new Boom.Boom(`Response Error: ${statusCode}`, {
    statusCode,
    data: { isResponseError: true, payload: body }
  })

/** As @hapi/wreck rejects when no connection could be made. */
const connectionError = () =>
  Boom.badGateway(
    'Client request error',
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
  )

describe('getOverviewUseCase', () => {
  test('answers the overview GAS read', async () => {
    vi.mocked(getOverview).mockResolvedValue(needsAttention)

    expect(await getOverviewUseCase()).toEqual({
      outcome: 'read',
      overview: needsAttention
    })
  })

  test('takes a bare 404 for a GAS without the overview, and warns', async () => {
    vi.mocked(getOverview).mockRejectedValue(
      responseError(404, { statusCode: 404, error: 'Not Found' })
    )

    expect(await getOverviewUseCase()).toEqual({ outcome: 'not-offered' })
    expect(logger.warn).toHaveBeenCalledWith(
      'fg-gas-backend has no overview route'
    )
  })

  test.each([
    ['a 404 with a code', responseError(404, { errorCode: 'X' }), 'refused'],
    ['a 500', responseError(500), 'errored'],
    ['a 504', responseError(504), 'timed-out'],
    ['no connection', connectionError(), 'not-connected'],
    ['no answer', Boom.gatewayTimeout('Client request timeout'), 'no-answer']
  ])('says how it failed for %s, and logs it', async (_, error, kind) => {
    vi.mocked(getOverview).mockRejectedValue(error)

    const result = await getOverviewUseCase()

    expect(result).toMatchObject({ outcome: 'failed', failure: { kind } })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not read the overview from fg-gas-backend')
    )
  })
})
