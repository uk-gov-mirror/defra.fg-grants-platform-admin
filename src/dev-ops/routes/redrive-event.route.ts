import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { redriveEventUseCase } from '../use-cases/redrive-event.use-case.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import { toEventHref } from '../view-models/event-formats.ts'
import {
  eventBannerId,
  redriveNoticeKey,
  toSafeFrom
} from '../view-models/event-page.view-model.ts'
import { toActor } from '../../common/view-models/actor.ts'
import { seeOther } from '../view-models/see-other.ts'
import { fromMax } from '../view-models/record-filters.ts'

/**
 * The page the operator was on, and nothing about the outcome: a parameter
 * saying how it went would be repeated by every refresh of the page it lands
 * on. The outcome rides the session instead, which is spent on one render.
 */
const toRedirect = (key: EventKey, from: string): string => {
  const href = toEventHref(key)
  const query = from === '' ? '' : `?back=${encodeURIComponent(from)}`

  return `${href}${query}#${eventBannerId}`
}

/**
 * No CSRF token, deliberately and not by omission — but the defence is the
 * cookie, not the harmlessness of the write. A forged request could redrive
 * ANY dead letter and put the victim's name on it, because `x-actor` is read
 * off their session: that is a real thing to stop, and what stops a
 * cross-site one is `isSameSite: 'Strict'` on the session cookie, pinned
 * explicitly in server/plugins/session-cache/index.ts so it cannot drift into
 * a default. A cross-site POST simply arrives without the cookie, so it never
 * reaches the scope check, let alone the queue.
 *
 * A same-site one still carries it: every `*.cdp-int.defra.cloud` frontend is
 * the same site as this app. src/dev-ops/index.ts closes that by registering
 * this write through `sameOriginOnly`, as the access token writes are.
 *
 * A crumb here would be a token in one place out of one, which is the shape
 * of a defence that quietly stops working.
 *
 * No `options.auth` for the same reason as its neighbours: src/dev-ops/index.ts
 * registers this through `scopedTo`, and that helper only scopes a route that
 * declares no auth of its own.
 */
export const redriveEventRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/{service}/{box}/{id}/redrive',
  options: {
    validate: {
      params: Joi.object(eventAddress),
      // The form carries one field, and only so the page it returns to is the
      // page the operator started from. An absent or hostile value is dropped
      // by `toSafeFrom`, exactly as it is on the inspect page itself, and it
      // is bounded because it is echoed into the redirect.
      //
      // `.empty(null)` earns its place: hapi hands a body-less POST a payload
      // of `null`, and a Joi `default` only fires on `undefined` - so without
      // it, a POST with no body at all was a 400 rather than the "redrive and
      // go back to the first list" this claims to accept.
      payload: Joi.object({
        back: Joi.string().allow('').max(fromMax).default('')
      })
        .empty(null)
        .default({})
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = toEventKey(request.params)
    const { back: from } = request.payload as { back?: string }
    const result = await redriveEventUseCase(key, toActor(request))

    request.yar.flash(redriveNoticeKey, {
      ...result,
      action: 'redrive',
      page: toEventHref(key)
    })

    return h.redirect(toRedirect(key, toSafeFrom(from))).code(seeOther)
  }
}
