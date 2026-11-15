import hapi from '@hapi/hapi'
import type { Request } from '@hapi/hapi'
import Joi from 'joi'

import { config } from '../../../common/config.ts'
import { isSameOrigin, sameOriginOnly } from './same-origin.ts'

const app = new URL(config.get('auth.appBaseUrl')).origin

describe('isSameOrigin', () => {
  test.each([
    [
      'same-origin, with the app origin',
      { 'sec-fetch-site': 'same-origin', origin: app }
    ],
    ['same-origin, with no origin', { 'sec-fetch-site': 'same-origin' }],
    [
      'the app origin, from a browser that sends no Sec-Fetch-Site',
      { origin: app }
    ]
  ])('accepts %s', (_name, headers) => {
    expect(isSameOrigin(headers)).toBe(true)
  })

  test.each([
    [
      'a cross-site request',
      { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }
    ],
    [
      'a same-site request from a sibling frontend',
      {
        'sec-fetch-site': 'same-site',
        origin: 'https://other.cdp-int.defra.cloud'
      }
    ],
    ['a request with neither header', {}],
    [
      'another origin, with no Sec-Fetch-Site',
      { origin: 'https://evil.example' }
    ],
    ['the app origin on a different port', { origin: `${app}1` }],
    ['a null origin', { origin: 'null' }],
    [
      'headers that disagree',
      { 'sec-fetch-site': 'same-origin', origin: 'https://evil.example' }
    ],
    ['a navigation typed into the address bar', { 'sec-fetch-site': 'none' }]
  ])('refuses %s', (_name, headers) => {
    expect(isSameOrigin(headers)).toBe(false)
  })
})

describe('sameOriginOnly', () => {
  const handler = vi.fn((request: Request) => request.pre.later)
  const server = hapi.server()

  beforeAll(async () => {
    server.route(
      sameOriginOnly([
        {
          method: 'POST',
          path: '/write',
          options: {
            pre: [{ method: () => 'later', assign: 'later' }],
            validate: { payload: Joi.object({ name: Joi.string().required() }) }
          },
          handler
        }
      ])
    )
    await server.initialize()
  })

  test('refuses a cross-site write before its handler runs', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/write',
      headers: { 'sec-fetch-site': 'cross-site' }
    })

    expect(statusCode).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  test('refuses a cross-site write before it validates the payload', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/write',
      payload: {},
      headers: { 'sec-fetch-site': 'cross-site' }
    })

    expect(statusCode).toBe(403)
  })

  test('lets a same-origin write through, still running its own steps', async () => {
    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/write',
      payload: { name: 'Ada' },
      headers: { 'sec-fetch-site': 'same-origin' }
    })

    expect(statusCode).toBe(200)
    expect(result).toBe('later')
  })
})
