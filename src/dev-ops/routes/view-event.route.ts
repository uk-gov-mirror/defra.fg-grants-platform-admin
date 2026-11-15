import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { toBackBucket } from '../view-models/bucket-nav.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import type { EventPageQuery } from '../view-models/event-page.view-model.ts'
import {
  eventPageCache,
  purgeFormKey,
  redriveNoticeKey,
  toEventPage,
  toSafeFrom
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
      // `back` is checked by the view model: a bad one falls back to the admin's root, not an error page.
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
    const query = request.query as unknown as EventPageQuery
    // Read and cleared before the event is, so a write's message and a
    // rejected form are spent on this render whatever the read then says.
    const [notice] = request.yar.flash(redriveNoticeKey)
    const [form] = request.yar.flash(purgeFormKey)
    const result = await getEventUseCase(key)
    const from = toSafeFrom(query.back)
    const bucket = toBackBucket(await getCatalogueUseCase(), from)
    const navActive = bucket?.id ?? null

    if (result.outcome === 'not-found') {
      return h.view('event-not-found', {
        pageTitle: 'Event not found',
        backHref: from,
        navActive
      })
    }

    return h.view('event', {
      pageTitle: 'Event',
      ...toEventPage(
        result,
        key,
        query,
        timesOf(request).zone,
        notice,
        form,
        undefined,
        bucket
      )
    })
  }
}
