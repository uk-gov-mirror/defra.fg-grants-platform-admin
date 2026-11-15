import nunjucks from 'nunjucks'
import type { Environment } from 'nunjucks'
import type { Server } from '@hapi/hapi'

import { devOpsSignedOutPath } from '../server/plugins/auth/paths.ts'

const macros = 'components/macros.njk'

const readSource = vi.spyOn(nunjucks.FileSystemLoader.prototype, 'getSource')

const compile = vi.spyOn(nunjucks, 'compile')

const macrosReads = () =>
  readSource.mock.calls.filter(([name]) => name === macros).length

let server: Server

let environment: Environment

/** Reads of the macros while the plugin registered: counted before each test's calls are cleared. */
let readsAtStart: number

/**
 * One app, booted once: this file has its own module graph, so the spies
 * above see the plugin compile the macros as it registers. Booting is the
 * costly part, so it is setup, not a test's own time, with time enough for
 * the boot under load.
 */
beforeAll(async () => {
  const [{ plugins }, { createServer }, viewOptions] = await Promise.all([
    import('../main.ts'),
    import('../server/index.ts'),
    import('./view-options.ts')
  ])
  server = await createServer()
  await server.register(plugins)
  await server.initialize()
  environment = viewOptions.environment
  readsAtStart = macrosReads()
}, 20_000)

afterAll(async () => {
  await server.stop()
})

const signedOutPage = () =>
  server.inject({ method: 'GET', url: devOpsSignedOutPath })

describe('the Dev Ops views', () => {
  test('compile the design system macros once, as the plugin registers, and never for a page', async () => {
    expect(readsAtStart).toBe(1)

    await signedOutPage()
    await signedOutPage()

    expect(macrosReads()).toBe(0)
  })

  test('draw every page with the one environment, so what it has compiled is kept', async () => {
    await signedOutPage()
    await signedOutPage()

    const [first, second] = compile.mock.calls.map(([, used]) => used)
    expect(compile).toHaveBeenCalledTimes(2)
    expect(first).toBe(environment)
    expect(second).toBe(environment)
  })
})
