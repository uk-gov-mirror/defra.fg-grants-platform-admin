import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { devOpsPath } from '../view-models/bucket-nav.ts'
import { toSafeFrom } from '../view-models/event-page.view-model.ts'
import { backSchema } from '../view-models/record-filters.ts'
import { seeOther } from '../view-models/see-other.ts'
import {
  timesChoices,
  timesCookieName,
  shellQuery,
  timesPath,
  toTimesDialog
} from '../view-models/times.ts'

const query = Joi.object({ back: backSchema, ...shellQuery })

/** Where the setting goes back to: the page it was opened from, or Dev Ops' front door. */
const toBack = (request: Request): string =>
  toSafeFrom(String(request.query.back ?? '')) || devOpsPath

/**
 * The Times address itself is no page: it goes back to the page it names, with
 * the dialog open. Signing in again after a save that met no session lands here.
 */
export const viewTimesRoute: ServerRoute = {
  method: 'GET',
  path: timesPath,
  options: { validate: { query } },
  handler(request: Request, h: ResponseToolkit) {
    return h.redirect(toTimesDialog(undefined, toBack(request)).href)
  }
}

/** Kept in a cookie like the theme; the page it goes back to is drawn again in the chosen zone. */
export const saveTimesRoute: ServerRoute = {
  method: 'POST',
  path: timesPath,
  options: {
    validate: {
      query,
      payload: Joi.object({
        times: Joi.string()
          .valid(...timesChoices)
          .required()
      })
    }
  },
  handler(request: Request, h: ResponseToolkit) {
    const { times } = request.payload as { times: string }

    return h
      .redirect(toBack(request))
      .state(timesCookieName, times)
      .code(seeOther)
  }
}
