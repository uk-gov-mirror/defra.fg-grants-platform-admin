import Boom from '@hapi/boom'
import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import { queryBucket } from '../repositories/buckets.repository.ts'
import {
  getBucketAtUseCase,
  getCatalogueUseCase
} from '../use-cases/get-catalogue.use-case.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../repositories/buckets.repository.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

/** As @hapi/wreck rejects for GAS's answer, its body as Hapi sends GAS's Boom. */
const gasAnswer = (statusCode: number, error: string, message: string) =>
  new Boom.Boom(`Response Error: ${statusCode}`, {
    statusCode,
    data: { isResponseError: true, payload: { statusCode, error, message } }
  })

/** As @hapi/wreck rejects when no connection to GAS could be made. */
const notConnected = () =>
  Boom.badGateway(
    'Client request error',
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
  )

const answeredWithAnError =
  'GAS answered with an error. Nothing has changed — try again in a moment; if it keeps failing, check GAS’s logs.'

let server: Server

const view = async (url: string) => {
  const { result, statusCode } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials }
  })
  const $ = load(result as unknown as string)
  const alert = $('[data-testid="list-alert"]')

  return {
    statusCode,
    title: alert.find('.gpa-alert-title').text().replace(/\s+/g, ' ').trim(),
    body: alert
      .find('.gpa-alert-body > div')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim()
  }
}

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(getCatalogueUseCase).mockResolvedValue(fullCatalogue)
  vi.mocked(getBucketAtUseCase).mockImplementation(async (path) => ({
    available: true,
    bucket: fullCatalogue.buckets.find((bucket) => bucket.path === path) ?? null
  }))
})

afterAll(async () => {
  await server.stop()
})

describe('a CW list read through GAS, each way it can fail', () => {
  test.each([
    [
      'GAS’s own 500',
      () =>
        gasAnswer(
          500,
          'Internal Server Error',
          'An internal server error occurred'
        ),
      statusCodes.serviceUnavailable,
      answeredWithAnError
    ],
    [
      'GAS’s 502 for CW’s error',
      () =>
        gasAnswer(
          502,
          'Bad Gateway',
          'CW-BE buckets unavailable: Response Error: 500'
        ),
      statusCodes.serviceUnavailable,
      answeredWithAnError
    ],
    [
      'GAS’s 502 for a CW with no bucket routes',
      () => gasAnswer(502, 'Bad Gateway', 'CW-BE has no bucket routes'),
      statusCodes.serviceUnavailable,
      answeredWithAnError
    ],
    [
      'GAS’s 504 for CW not answering',
      () =>
        gasAnswer(
          504,
          'Gateway Time-out',
          'CW-BE did not answer in time for buckets'
        ),
      statusCodes.gatewayTimeout,
      'CW didn’t answer in time. Nothing has changed — try again in a moment.'
    ],
    [
      'GAS not answering in time',
      () => Boom.gatewayTimeout('Client request timeout'),
      statusCodes.gatewayTimeout,
      'GAS didn’t answer in time. Nothing has changed — try again in a moment.'
    ],
    [
      'the connection to GAS dropped mid-request',
      () =>
        Boom.badGateway(
          'Client request error',
          Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
        ),
      statusCodes.gatewayTimeout,
      'GAS didn’t answer in time. Nothing has changed — try again in a moment.'
    ],
    [
      'no connection to GAS',
      notConnected,
      statusCodes.serviceUnavailable,
      'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
    ]
  ])('cases: %s', async (_name, error, status, body) => {
    vi.mocked(queryBucket).mockRejectedValue(error())

    const page = await view('/dev-ops/cases')

    expect(page).toEqual({
      statusCode: status,
      title: 'The cases list couldn’t be loaded.',
      body
    })
  })
})

describe('every kind of list, when GAS answers with an error', () => {
  test.each([
    ['/dev-ops/events/gas/outbox', 'events'],
    ['/dev-ops/events/cw/outbox', 'events'],
    ['/dev-ops/applications', 'applications'],
    ['/dev-ops/cases', 'cases'],
    ['/dev-ops/grants', 'grant versions'],
    ['/dev-ops/workflows', 'workflow versions']
  ])('%s names GAS and its logs', async (url, noun) => {
    vi.mocked(queryBucket).mockRejectedValue(
      gasAnswer(
        502,
        'Bad Gateway',
        'CW-BE buckets unavailable: Response Error: 500'
      )
    )

    expect(await view(url)).toEqual({
      statusCode: statusCodes.serviceUnavailable,
      title: `The ${noun} list couldn’t be loaded.`,
      body: answeredWithAnError
    })
  })
})
