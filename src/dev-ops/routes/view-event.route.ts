import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { config } from '../../common/config.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import type { EventPageQuery } from '../view-models/event-page.view-model.ts'
import {
  eventPageCache,
  isProduction,
  purgeFormKey,
  redriveNoticeKey,
  toEventPage,
  toEventStatusCode
} from '../view-models/event-page.view-model.ts'
import { fromMax } from '../view-models/record-filters.ts'
import { shellQuery, timesOf } from '../view-models/times.ts'

export const viewEventRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events/{service}/{box}/{id}',
  options: {
    cache: eventPageCache,
    validate: {
      params: Joi.object(eventAddress),
      // `back` is checked by the view model: a bad one falls back to the event's own list, not an error page.
      query: Joi.object({
        // Bounded because it is echoed into every link on the page.
        back: Joi.string().allow('').max(fromMax),
        confirm: Joi.string(),
        edit: Joi.string(),
        ...shellQuery
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = toEventKey(request.params)
    // Taken before the event is read, so a write's message and a rejected
    // form are spent on this render whatever the read then says.
    const [notice] = request.yar.flash(redriveNoticeKey)
    const [form] = request.yar.flash(purgeFormKey)
    const page = toEventPage({
      result: await getEventUseCase(key),
      key,
      times: timesOf(request),
      catalogue: await getCatalogueUseCase(),
      prod: isProduction(config.get('environmentLabel')),
      query: request.query as EventPageQuery,
      notice,
      form
    })

    return h.view('events/event', page).code(toEventStatusCode(page))
  }
}
