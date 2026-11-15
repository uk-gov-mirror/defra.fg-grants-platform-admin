import { logger } from '../../common/logger.ts'
import type { BucketResult } from '../repositories/buckets.repository.ts'
import { queryBucket } from '../repositories/buckets.repository.ts'
import { outboxBucket } from './test-fixtures.ts'
import { queryBucketUseCase } from './query-bucket.use-case.ts'

vi.mock(import('../repositories/buckets.repository.ts'))
vi.mock(import('../../common/logger.ts'))

/** As @hapi/wreck rejects for an answer GAS gave. */
const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { isResponseError: true, payload: body }
  })

const result: BucketResult = {
  bucket: 'gas.outbox',
  plan: {
    kind: 'exact',
    index: ['kind', 'publicationDate', '_id'],
    bound: [],
    filled: [],
    residual: [],
    scans: 1
  },
  rows: [],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: []
}

describe('queryBucketUseCase', () => {
  test('asks a first page for twenty rows and its total, and no counts by group', async () => {
    vi.mocked(queryBucket).mockResolvedValue(result)

    await queryBucketUseCase(
      outboxBucket,
      { where: { status: 'DEAD_LETTER' }, from: '2026-10-08T12:00:00.000Z' },
      false
    )

    expect(queryBucket).toHaveBeenCalledWith(
      'gas.outbox',
      {
        where: { status: 'DEAD_LETTER' },
        from: '2026-10-08T12:00:00.000Z',
        limit: 20,
        count: true
      },
      false
    )
  })

  test('asks a search’s first page for its total too', async () => {
    vi.mocked(queryBucket).mockResolvedValue(result)

    await expect(
      queryBucketUseCase(
        outboxBucket,
        {
          where: { status: 'DEAD_LETTER' },
          ref: 'ref:abc-123-xyz',
          from: '2026-10-08T12:00:00.000Z'
        },
        true
      )
    ).resolves.toEqual({
      page: result,
      unavailable: false,
      timedOut: false,
      errored: false,
      refused: false,
      refusal: null
    })
    expect(queryBucket).toHaveBeenCalledWith(
      'gas.outbox',
      {
        where: { status: 'DEAD_LETTER' },
        ref: 'ref:abc-123-xyz',
        from: '2026-10-08T12:00:00.000Z',
        limit: 20,
        count: true
      },
      true
    )
  })

  test('asks a later page for its total too, which a page opened without the script draws', async () => {
    vi.mocked(queryBucket).mockResolvedValue(result)

    await queryBucketUseCase(
      outboxBucket,
      { where: {}, ref: 'ref:abc-123-xyz', cursor: 'eyJ0Ijoi' },
      false
    )

    expect(queryBucket).toHaveBeenCalledWith(
      'gas.outbox',
      {
        where: {},
        ref: 'ref:abc-123-xyz',
        cursor: 'eyJ0Ijoi',
        limit: 20,
        count: true
      },
      false
    )
  })

  test('carries the reason GAS gave for refusing a request', async () => {
    vi.mocked(queryBucket).mockRejectedValue(
      responseError(400, {
        statusCode: 400,
        error: 'Bad Request',
        message: 'A filter names a fact this bucket does not declare',
        reason: 'UNKNOWN_FACT'
      })
    )

    await expect(
      queryBucketUseCase(outboxBucket, { where: { colour: 'x' } }, false)
    ).resolves.toEqual({
      page: null,
      unavailable: false,
      timedOut: false,
      errored: false,
      refused: true,
      refusal: 'A filter names a fact this bucket does not declare'
    })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('refused the bucket gas.outbox list parameters')
    )
  })

  test('says a refusal with no reason was one all the same', async () => {
    vi.mocked(queryBucket).mockRejectedValue(responseError(400))

    await expect(
      queryBucketUseCase(outboxBucket, { where: {} }, false)
    ).resolves.toMatchObject({ refused: true, refusal: null })
  })

  test.each([404, 500, 502, 503, 504])(
    'says the list is unavailable on a %i, carrying no reason: a timeout for a 504, else an error GAS answered with',
    async (statusCode) => {
      vi.mocked(queryBucket).mockRejectedValue(
        responseError(statusCode, { message: 'No such bucket' })
      )

      await expect(
        queryBucketUseCase(outboxBucket, { where: {} }, false)
      ).resolves.toEqual({
        page: null,
        unavailable: true,
        timedOut: statusCode === 504,
        errored: statusCode !== 504,
        refused: false,
        refusal: null
      })
      expect(logger.error).toHaveBeenCalled()
    }
  )

  test.each([
    [
      'no connection to GAS',
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED'
      }),
      { timedOut: false, errored: false }
    ],
    [
      'a timeout here',
      Object.assign(new Error('Client request timeout'), {
        output: { statusCode: 504 }
      }),
      { timedOut: true, errored: false, gasSilent: true }
    ],
    [
      'GAS saying it couldn’t reach CW',
      responseError(503, { errorCode: 'CW_UNREACHABLE' }),
      { timedOut: false, errored: true }
    ]
  ])('tells %s apart', async (_name, error, expected) => {
    vi.mocked(queryBucket).mockRejectedValue(error)

    await expect(
      queryBucketUseCase(outboxBucket, { where: {} }, false)
    ).resolves.toMatchObject({ unavailable: true, ...expected })
  })
})
