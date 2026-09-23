import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { eventAddress } from '../view-models/event-address.ts'
import type { EventPageQuery } from '../view-models/event-page.view-model.ts'
import {
  eventPageCache,
  purgeFormKey,
  redriveNoticeKey,
  toEventPage,
  toSafeFrom
} from '../view-models/event-page.view-model.ts'

/** Longer than any query this page builds for itself, and still bounded. */
const fromMax = 2048

export const viewEventRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events/{service}/{box}/{id}',
  options: {
    cache: eventPageCache,
    validate: {
      params: Joi.object(eventAddress),
      // `from` is checked by the view model: a bad one falls back to the plain list, not an error page.
      query: Joi.object({
        // Bounded because it is echoed into every link on the page.
        from: Joi.string().allow('').max(fromMax),
        confirm: Joi.string(),
        edit: Joi.string()
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as EventKey
    const query = request.query as unknown as EventPageQuery
    // Read and cleared before the event is, so a write's message and a
    // rejected form are spent on this render whatever the read then says.
    const [notice] = request.yar.flash(redriveNoticeKey)
    const [form] = request.yar.flash(purgeFormKey)
    const result = await getEventUseCase(key)

    if (result.outcome === 'not-found') {
      return h.view('event-not-found', {
        pageTitle: 'Event not found',
        backHref: `/dev-ops/events${toSafeFrom(query.from)}`
      })
    }

    return h.view('event', {
      pageTitle: 'Event',
      ...toEventPage(result, key, query, notice, form)
    })
  }
}
