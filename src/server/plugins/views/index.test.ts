import nunjucks from 'nunjucks'
import type { Server } from '@hapi/hapi'

let server: Server

/** A fresh app each time, so no test finds templates another one compiled. */
const start = async () => {
  vi.resetModules()
  const [{ createServer }, { environment }] = await Promise.all([
    import('../../index.ts'),
    import('./engine.ts')
  ])
  server = await createServer()
  await server.initialize()

  return environment
}

const notFoundPage = () =>
  server.inject({ method: 'GET', url: '/non-existent-path' })

afterEach(async () => {
  await server.stop()
})

describe('the GDS views', () => {
  test('read no template again for a second render of a page', async () => {
    const readSource = vi.spyOn(
      nunjucks.FileSystemLoader.prototype,
      'getSource'
    )

    await start()
    await notFoundPage()
    const firstReads = readSource.mock.calls.length
    await notFoundPage()

    expect(firstReads).toBeGreaterThan(0)
    expect(readSource).toHaveBeenCalledTimes(firstReads)
  })

  test('draw every page with the one environment, so what it has compiled is kept', async () => {
    const compile = vi.spyOn(nunjucks, 'compile')

    const environment = await start()
    await notFoundPage()
    await notFoundPage()

    const [first, second] = compile.mock.calls.map(([, used]) => used)
    expect(compile).toHaveBeenCalledTimes(2)
    expect(first).toBe(environment)
    expect(second).toBe(environment)
  })
})
