import Boom from '@hapi/boom'

import { toGasFailure } from './gas-status.ts'

const withCode = (code: string) =>
  Object.assign(Boom.badGateway('Client request error'), { code })

const answered = (statusCode: number, payload: object = {}) =>
  Object.assign(
    new Boom.Boom(`Response Error: ${statusCode}`, { statusCode }),
    {
      data: { isResponseError: true, payload }
    }
  )

describe('toGasFailure', () => {
  test.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])(
    '%s: no connection was made',
    (code) => {
      expect(toGasFailure(withCode(code))).toEqual({ kind: 'not-connected' })
    }
  )

  test.each([
    ['a dropped connection', withCode('ECONNRESET')],
    ['a broken pipe', withCode('EPIPE')],
    ['a socket that went quiet', withCode('ETIMEDOUT')],
    ['wreck’s read timeout', Boom.clientTimeout()],
    ['wreck’s own timeout', Boom.gatewayTimeout('Client request timeout')]
  ])('%s: GAS sent nothing', (_, error) => {
    expect(toGasFailure(error)).toEqual({ kind: 'no-answer' })
  })

  test.each([
    ['an answer that could not be read', Boom.badGateway('Bad payload')],
    ['a plain error', new Error('Unexpected')]
  ])('%s: errored, not taken for no answer', (_, error) => {
    expect(toGasFailure(error)).toEqual({ kind: 'errored' })
  })

  test('GAS’s own 504 is a timeout it answered', () => {
    expect(toGasFailure(answered(504))).toEqual({ kind: 'timed-out' })
  })

  test('GAS’s 4xx is a refusal, with its code', () => {
    expect(toGasFailure(answered(400, { errorCode: 'X' }))).toEqual({
      kind: 'refused',
      statusCode: 400,
      errorCode: 'X'
    })
  })
})
