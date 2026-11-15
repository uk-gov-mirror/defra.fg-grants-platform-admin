import type { Server } from '@hapi/hapi'

import { devOpsSignedOutPath } from '../server/plugins/auth/paths.ts'
import { sameOriginOnly } from '../server/plugins/auth/same-origin.ts'
import { scopedTo } from '../server/plugins/auth/scoped-to.ts'
import { asOperator } from '../common/as-operator.ts'
import { config } from '../common/config.ts'
import { roles } from '../common/roles.ts'
import {
  accessTokenWriteRoutes,
  viewAccessTokensRoute
} from './routes/access-tokens.route.ts'
import {
  searchBucketRoute,
  viewBucketRoute,
  viewDevOpsRoute
} from './routes/bucket-list.route.ts'
import {
  fetchGrantDefinitionsRoute,
  fetchWorkflowDefinitionRoute
} from './routes/fetch-definitions.route.ts'
import { purgeEventRoute } from './routes/purge-event.route.ts'
import {
  viewApplicationRoute,
  viewCaseRoute,
  viewCurrentGrantRoute,
  viewCurrentWorkflowRoute,
  viewGrantRoute,
  viewWorkflowRoute
} from './routes/record-pages.route.ts'
import { redriveEventRoute } from './routes/redrive-event.route.ts'
import { reviewPayloadRoute } from './routes/review-payload.route.ts'
import { savePayloadRoute } from './routes/save-payload.route.ts'
import { viewEventRoute } from './routes/view-event.route.ts'
import { saveTimesRoute, viewTimesRoute } from './routes/times.route.ts'
import { toSignedOutRoute } from './routes/signed-out.route.ts'
import { toStatusResponse } from './status-pages.ts'
import { timesCookieName } from './view-models/times.ts'
import { compileDesignSystemMacros, devOpsViewOptions } from './view-options.ts'

const yearMs = 365 * 24 * 60 * 60 * 1000

/** The Times setting, kept a year like the theme; only the server reads it. */
const timesCookieOptions = {
  ttl: yearMs,
  path: '/',
  isSecure: config.get('session.cookie.secure'),
  isHttpOnly: true,
  isSameSite: 'Strict' as const,
  encoding: 'none' as const,
  clearInvalid: true,
  ignoreErrors: true
}

export const devOps = {
  plugin: {
    name: 'dev-ops',
    register(server: Server) {
      server.views({
        ...devOpsViewOptions,
        relativeTo: import.meta.dirname,
        path: 'views'
      })
      compileDesignSystemMacros()

      server.state(timesCookieName, timesCookieOptions)

      // Before the CSP plugin, so the page it draws in place of an error gets the header too.
      server.ext('onPreResponse', toStatusResponse, {
        sandbox: 'plugin',
        before: ['errors', 'blankie']
      })

      server.route(toSignedOutRoute(devOpsSignedOutPath))

      server.route(
        scopedTo(
          roles.grantOperationsAdmin,
          asOperator([
            viewDevOpsRoute,
            viewBucketRoute,
            viewApplicationRoute,
            viewCaseRoute,
            viewGrantRoute,
            viewCurrentGrantRoute,
            viewWorkflowRoute,
            viewCurrentWorkflowRoute,
            viewEventRoute,
            viewAccessTokensRoute,
            viewTimesRoute,
            ...sameOriginOnly([
              searchBucketRoute,
              fetchGrantDefinitionsRoute,
              fetchWorkflowDefinitionRoute,
              redriveEventRoute,
              purgeEventRoute,
              reviewPayloadRoute,
              savePayloadRoute,
              ...accessTokenWriteRoutes,
              saveTimesRoute
            ])
          ])
        )
      )
    }
  }
}
