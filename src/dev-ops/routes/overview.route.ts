import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { getOverviewUseCase } from '../use-cases/get-overview.use-case.ts'
import { listPageCache } from '../view-models/list-filters.ts'
import {
  overviewPath,
  toOverviewPage,
  toOverviewStatusCode
} from '../view-models/overview-page.view-model.ts'
import { shellQuery, timesOf } from '../view-models/times.ts'

/** The admin's own root, where sign-in lands: both services at a glance, from one GAS read. */
export const viewOverviewRoute: ServerRoute = {
  method: 'GET',
  path: overviewPath,
  options: {
    cache: listPageCache,
    validate: { query: Joi.object(shellQuery) }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const result = await getOverviewUseCase()

    return h
      .view('overview', toOverviewPage(result, { times: timesOf(request) }))
      .code(toOverviewStatusCode(result))
  }
}
