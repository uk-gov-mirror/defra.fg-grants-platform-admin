import path from 'node:path'
import nunjucks from 'nunjucks'

import { config } from '../common/config.ts'
import { roles } from '../common/roles.ts'
import { addDesignSystem } from './views/components/nunjucks.ts'
import {
  devOpsSignedOutPath,
  loginPath,
  logoutPath
} from '../server/plugins/auth/paths.ts'
import { assets } from '../server/plugins/views/assets.ts'
import { getCatalogueUseCase } from './use-cases/get-catalogue.use-case.ts'
import { toCodeBreaks } from './view-models/code-text.ts'
import {
  toHomeHref,
  toHomeLabel,
  toNavSections
} from './view-models/bucket-nav.ts'
import { toClientsPath } from './view-models/access-token-services.ts'
import { toSidebarSections } from './view-models/shell.ts'
import { toSignedInUser } from './view-models/signed-in-user.ts'
import { toRefererBack } from './view-models/status-page.ts'
import { timesOf, toTimesDialog, toTimesOptions } from './view-models/times.ts'
import {
  buildViewOptions,
  type ViewContextRequest
} from '../server/plugins/views/index.ts'

/**
 * The dev-ops app's own nunjucks environment. Its search path is this
 * domain's views directory, the design system's components among them — no
 * govuk-frontend, no src/common/views — so the two design systems meet only
 * at the server and auth layer, never in a template.
 */
const viewsPath = path.resolve(import.meta.dirname, 'views')

export const environment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader([viewsPath], {
    watch: config.get('nunjucks.watch'),
    noCache: config.get('nunjucks.noCache')
  }),
  {
    autoescape: true,
    throwOnUndefined: false,
    trimBlocks: true,
    lstripBlocks: true
  }
)

addDesignSystem(environment)
environment.addFilter('codeBreaks', toCodeBreaks)
environment.addGlobal('sidebarSections', toSidebarSections)

/**
 * Every page imports the design system's macros, the costliest template to
 * compile, so they are compiled once before the first page asks for them. A
 * macros file that does not compile stops the server starting, since no page
 * could be drawn without it.
 */
export const compileDesignSystemMacros = () => {
  environment.getTemplate('components/macros.njk', true)
}

/**
 * An operator with four tabs open needs the one they are about to redrive an
 * event in to look different from the other three: the sidebar's badge names
 * the environment, and the design system draws production in its danger tone.
 */
const themeCookieName = 'dev-ops-theme'
const themes = { dark: 'dark', light: 'light' } as const

const selectedTheme = (request?: ViewContextRequest) => {
  const theme = String(request?.state?.[themeCookieName])
  return themes[theme as keyof typeof themes] ?? null
}

/** Dev Ops' Sign out ends on Dev Ops' own signed out page. */
const signOutHref = `${logoutPath}?next=${encodeURIComponent(devOpsSignedOutPath)}`

const tokensHref = toClientsPath('gas')

const isGet = ({ method }: ViewContextRequest): boolean =>
  (method ?? 'get').toLowerCase() === 'get'

/** A page drawn in answer to a form has no address to open the Times dialog over: the page the form came from stands in. */
const toTimesContext = (request: ViewContextRequest, fallback: string) => {
  const times = timesOf(request)
  const from = toRefererBack(request.headers?.referer) ?? fallback

  return {
    times,
    timesDialog: toTimesDialog(isGet(request) ? request.url : undefined, from),
    timesOptions: toTimesOptions(times)
  }
}

const userOf = ({ auth }: ViewContextRequest) =>
  toSignedInUser(auth?.credentials?.user)

/** Only someone who may use Dev Ops has GAS asked for its lists: a refused or signed out page draws none. */
const mayUseDevOps = ({ auth }: ViewContextRequest): boolean =>
  [auth?.credentials?.scope ?? []].flat().includes(roles.grantOperationsAdmin)

const catalogueFor = async (request: ViewContextRequest) =>
  mayUseDevOps(request) ? getCatalogueUseCase() : null

/** The response's CSP style nonce, for the <style> each DataTable sets its column widths in. */
const styleNonceOf = ({ plugins }: ViewContextRequest) =>
  plugins?.blankie?.nonces?.style

const context = async (request: ViewContextRequest = {}) => {
  const catalogue = await catalogueFor(request)
  const homeHref = toHomeHref(catalogue)

  return {
    productName: 'Grants Platform',
    devOpsTheme: selectedTheme(request),
    themeCookieName,
    environmentLabel: config.get('environmentLabel'),
    signedInUser: userOf(request),
    navSections: toNavSections(catalogue),
    homeHref,
    homeLabel: toHomeLabel(catalogue),
    tokensHref,
    signOutHref,
    signInHref: loginPath,
    styleNonce: styleNonceOf(request),
    ...toTimesContext(request, homeHref ?? tokensHref),
    ...(await assets())
  }
}

export const devOpsViewOptions = buildViewOptions(environment, context)
