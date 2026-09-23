import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { eventAddress } from '../view-models/event-address.ts'
import {
  eventPageCache,
  toSafeFrom
} from '../view-models/event-page.view-model.ts'
import { toPayloadPage } from '../view-models/payload-edit-page.ts'
import { formMaxBytes } from '../view-models/payload-form.ts'

/** Longer than any query this app builds for itself, and still bounded. */
const fromMax = 2048

interface ReviewPayload {
  text: string
  revision: number
  from: string
  back?: string
}

/**
 * Review changes, and Back to editing. Nothing is written, so the answer is
 * the page itself rather than a redirect: the text the operator typed goes
 * back to them in the page body, never in a url or the session. A refresh
 * asks to post it again, which is harmless.
 *
 * No CSRF token and no `options.auth`, for the reasons the redrive route
 * spells out.
 */
export const reviewPayloadRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/{service}/{box}/{id}/payload/review',
  options: {
    cache: eventPageCache,
    payload: { maxBytes: formMaxBytes },
    validate: {
      params: Joi.object(eventAddress),
      // The text is not bounded here: a text over the bound is a sentence in
      // front of the editor, not a 400 in place of it.
      payload: Joi.object({
        text: Joi.string().allow('').default(''),
        revision: Joi.number().integer().min(0).required(),
        from: Joi.string().allow('').max(fromMax).default(''),
        back: Joi.string().valid('edit'),
        // Back to editing posts the save form, note and all; the note is not kept.
        note: Joi.string().allow('').strip()
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as EventKey
    const { text, revision, from, back } = request.payload as ReviewPayload
    const result = await getEventUseCase(key)

    if (result.outcome === 'not-found') {
      return h.view('event-not-found', {
        pageTitle: 'Event not found',
        backHref: `/dev-ops/events${toSafeFrom(from)}`
      })
    }

    return h.view('event', {
      pageTitle: 'Event',
      ...toPayloadPage(result, key, {
        text,
        revision,
        from,
        back: back === 'edit'
      })
    })
  }
}
