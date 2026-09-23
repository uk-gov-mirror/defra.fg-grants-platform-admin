import type { Server } from '@hapi/hapi'

import { scopedTo } from '../server/plugins/auth/scoped-to.ts'
import { purgeEventRoute } from './routes/purge-event.route.ts'
import { redriveEventRoute } from './routes/redrive-event.route.ts'
import { reviewPayloadRoute } from './routes/review-payload.route.ts'
import { savePayloadRoute } from './routes/save-payload.route.ts'
import { viewDevOpsRoute } from './routes/view-dev-ops.route.ts'
import { viewEventRoute } from './routes/view-event.route.ts'
import { viewEventsRoute } from './routes/view-events.route.ts'
import { devOpsViewOptions } from './view-options.ts'

export const devOps = {
  plugin: {
    name: 'dev-ops',
    register(server: Server) {
      server.views({
        ...devOpsViewOptions,
        relativeTo: import.meta.dirname,
        path: 'views'
      })

      server.route(
        scopedTo('FCP.GrantOperationsAdmin', [
          viewDevOpsRoute,
          viewEventsRoute,
          viewEventRoute,
          redriveEventRoute,
          purgeEventRoute,
          reviewPayloadRoute,
          savePayloadRoute
        ])
      )
    }
  }
}
