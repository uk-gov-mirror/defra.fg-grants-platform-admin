import type { Server } from '@hapi/hapi'

import { createServer } from '../index.ts'

describe('contentSecurityPolicy', () => {
  let server: Server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('sets the CSP header', async () => {
    const resp = await server.inject({
      method: 'GET',
      url: '/health'
    })

    expect(resp.headers['content-security-policy']).toBeDefined()
  })

  const directives = async () => {
    const resp = await server.inject({ method: 'GET', url: '/health' })

    return Object.fromEntries(
      String(resp.headers['content-security-policy'])
        .split(';')
        .map((directive) => directive.trim().split(/\s+/))
        .map(([name, ...sources]) => [name, sources])
    )
  }

  test('styles: the page’s own files, and inline only with this response’s nonce', async () => {
    const [style, ...sources] = (await directives())['style-src']

    expect(style).toBe("'self'")
    expect(sources).toEqual([expect.stringMatching(/^'nonce-[\w+/=-]+'$/)])
  })

  test('a new style nonce for every response', async () => {
    const first = (await directives())['style-src']
    const second = (await directives())['style-src']

    expect(second).not.toEqual(first)
  })

  test('scripts: the page’s own files and the GOV.UK snippet, no nonce, nothing unsafe', async () => {
    const policy = await directives()

    expect(policy['script-src']).toEqual([
      "'self'",
      "'sha256-GUQ5ad8JK5KmEWmROf3LZd9ge94daqNvd8xy9YS1iDw='"
    ])
    expect(JSON.stringify(policy)).not.toContain('unsafe')
  })
})
