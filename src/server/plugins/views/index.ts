import vision from '@hapi/vision'
import nunjucks from 'nunjucks'

import { context } from './context.ts'
import { environment, viewsRoot } from './engine.ts'
import { config } from '../../../common/config.ts'

/**
 * Everything a views manager needs apart from where its pages live and which
 * nunjucks environment resolves what they pull in. A domain spreads the result
 * into its own `server.views()` call, adding `relativeTo` and `path`, so
 * vision resolves `h.view('index')` against that domain's directory — a
 * handler never names a path through the source tree, and this file never
 * names a domain.
 *
 * The environment is a parameter because it is the seam between design
 * systems: GDS domains share the environment from ./engine.ts, while a domain
 * that is effectively its own app (dev-ops) brings an environment that
 * cannot even resolve a GDS template, so a stray govuk import fails at render
 * instead of silently working.
 */
export type ViewContextRequest = {
  path?: string
  url?: URL
  method?: string
  headers?: Record<string, unknown>
  state?: Record<string, unknown>
  auth?: { credentials?: { user?: unknown; scope?: string | string[] } | null }
  yar?: { id?: string | null; get(key: string): unknown }
  plugins?: { blankie?: { nonces?: { style?: string } } }
}

export const buildViewOptions = (
  environment: nunjucks.Environment,
  context: (request?: ViewContextRequest) => Promise<object>
) => ({
  engines: {
    njk: {
      // Not through compileOptions: vision deep-clones those on every compile, and a clone starts with an empty template cache.
      compile(src: string) {
        const template = nunjucks.compile(src, environment)
        return (ctx: object) => template.render(ctx)
      }
    }
  },
  isCached: config.get('isProduction'),
  context
})

/** The options shared by every GDS domain's views manager. */
export const viewOptions = buildViewOptions(environment, context)

/**
 * The fallback views manager, holding the pages that belong to no domain.
 *
 * Registered directly on the root server in ../../index.ts rather than wrapped
 * in a plugin of its own, because vision assigns the manager it builds to the
 * realm of whoever registers it. Wrapping this would bury the manager in that
 * wrapper's realm, where a route on the root server could no longer see it, and
 * the only symptom would be error pages failing to render.
 */
export const views = {
  plugin: vision,
  options: {
    ...viewOptions,
    relativeTo: viewsRoot,
    path: 'pages'
  }
}
