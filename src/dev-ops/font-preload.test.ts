import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

import { load } from 'cheerio'
import { build, createServer as createViteServer } from 'vite'

import { config } from '../common/config.ts'
import { plugins } from '../main.ts'
import { createServer } from '../server/index.ts'

vi.mock(import('../common/config.ts'))

const fontUrl = (css: string) =>
  /url\("?([^")]*InterVariable[^")]*)"?\)/.exec(css)?.[1]

/** The page's sans-serif stack: until Inter arrives, text is in a fallback sized to Inter's widths. */
const fontSans = (css: string) => /--font-sans:\s*([^;]*)/.exec(css)?.[1]

/** The page's head: the preloaded font, then the stylesheets, in order. */
const headOf = async () => {
  const server = await createServer()
  await server.register(plugins)
  await server.initialize()

  const { payload } = await server.inject('/dev-ops/signed-out')
  await server.stop()

  const $ = load(payload)
  const links = $('head link[rel="preload"], head link[rel="stylesheet"]')
    .toArray()
    .map((link) => $(link))

  return {
    first: links[0],
    preload: $('head link[rel="preload"]'),
    stylesheet: $('head link[rel="stylesheet"]').attr('href')
  }
}

const expectFontPreload = (preload: ReturnType<typeof load>['prototype']) => {
  expect(preload.attr('as')).toBe('font')
  expect(preload.attr('type')).toBe('font/woff2')
  expect(preload.is('[crossorigin]')).toBe(true)
}

describe('the Dev Ops layout preloads Inter', () => {
  test('at the address Vite’s dev server gives the font in the stylesheet', async () => {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'custom',
      logLevel: 'silent'
    })
    const devServer = http.createServer(vite.middlewares).listen(0)
    const origin = `http://127.0.0.1:${(devServer.address() as AddressInfo).port}`

    try {
      const { first, preload, stylesheet } = await headOf()
      const css = await (
        await fetch(`${origin}${stylesheet}`, {
          headers: { accept: 'text/css,*/*;q=0.1' }
        })
      ).text()
      const font = await fetch(`${origin}${preload.attr('href')}`)

      expect(first?.attr('rel')).toBe('preload')
      expectFontPreload(preload)
      expect(preload.attr('href')).toBe(fontUrl(css))
      expect(font.headers.get('content-type')).toBe('font/woff2')
      expect(fontSans(css)).toMatch(/^"Inter", "AU Sans Fallback",/)
    } finally {
      devServer.close()
      await vite.close()
    }
  })

  test('at the hashed address the production build gives it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-ops-build-'))

    try {
      await build({
        build: { outDir: path.join(root, '.public'), emptyOutDir: true },
        logLevel: 'silent'
      })
      config.set('root', root)
      config.set('isProduction', true)

      const { first, preload, stylesheet = '' } = await headOf()
      const css = await fs.readFile(
        path.join(root, '.public', stylesheet.replace(/^\/public\//, '')),
        'utf8'
      )
      const fontFile = path.join(
        root,
        '.public',
        (preload.attr('href') ?? '').replace(/^\/public\//, '')
      )

      expect(first?.attr('rel')).toBe('preload')
      expectFontPreload(preload)
      expect(preload.attr('href')).toMatch(
        /^\/public\/assets\/InterVariable-[\w-]+\.woff2$/
      )
      expect(preload.attr('href')).toBe(fontUrl(css))
      expect((await fs.stat(fontFile)).isFile()).toBe(true)
      expect(fontSans(css)).toMatch(/^"Inter", "AU Sans Fallback",/)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 60_000)
})
