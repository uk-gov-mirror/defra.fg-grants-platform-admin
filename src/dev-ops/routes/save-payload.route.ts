import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import {
  checkEditPayload,
  formMaxBytes
} from '../use-cases/edit-payload-command.ts'
import type { PayloadSubmission } from '../use-cases/edit-payload-step.ts'
import { editPayloadUseCase } from '../use-cases/edit-payload.use-case.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { toActor } from '../../common/view-models/actor.ts'
import { toBackBucket } from '../view-models/bucket-nav.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import { toEventHref } from '../view-models/event-formats.ts'
import {
  eventBannerId,
  eventPageCache,
  redriveNoticeKey,
  toSafeFrom
} from '../view-models/event-page.view-model.ts'
import {
  toPayloadPage,
  toUnattributedPage
} from '../view-models/payload-edit-page.ts'
import { seeOther } from '../view-models/see-other.ts'
import { fromMax } from '../view-models/record-filters.ts'
import { timesOf } from '../view-models/times.ts'

/** Four times the limit the form enforces: past 500 is the operator's mistake, to be shown with the note in front of them. */
const noteMax = 2000

interface SavePayload {
  text: string
  revision: number
  back: string
  note: string
}

/** To the banner, which takes focus there: the form posted to `#payload`, which a bare Location would inherit. */
const toRedirect = (key: EventKey, from: string): string => {
  const href = toEventHref(key)
  const query = from === '' ? '' : `?back=${encodeURIComponent(from)}`

  return `${href}${query}#${eventBannerId}`
}

/**
 * A rejected save is the review again, re-rendered from the posted text with
 * the note kept and the reason beside it, for the same reason the review is
 * rendered rather than redirected to. A stale one is the editor again, with
 * the text kept. Either way both are handed back if the event can't be read.
 */
const rerender = async (
  request: Request,
  h: ResponseToolkit,
  submission: PayloadSubmission
) => {
  const key = toEventKey(request.params)
  const result = await getEventUseCase(key)
  const bucket = toBackBucket(
    await getCatalogueUseCase(),
    toSafeFrom(submission.from)
  )

  return h.view(
    'event',
    toPayloadPage(result, key, submission, timesOf(request).zone, bucket)
  )
}

/**
 * Confirm save. The hidden text is read again rather than trusted, since it
 * came back from the browser. Only the outcome rides the session, and the
 * write is followed by a 303, as redrive and purge are.
 *
 * No CSRF token and no `options.auth`, for the reasons the redrive route
 * spells out.
 */
export const savePayloadRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/{service}/{box}/{id}/payload',
  options: {
    cache: eventPageCache,
    payload: { maxBytes: formMaxBytes },
    validate: {
      params: Joi.object(eventAddress),
      payload: Joi.object({
        text: Joi.string().allow('').default(''),
        revision: Joi.number().integer().min(0).required(),
        back: Joi.string().allow('').max(fromMax).default(''),
        // Truncated rather than refused: a pasted payload is a note to
        // shorten, and the form can only say so with the note in front of it.
        note: Joi.string().allow('').max(noteMax).truncate().default('')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = toEventKey(request.params)
    const { text, revision, back: from, note } = request.payload as SavePayload
    const check = checkEditPayload({ text, revision, note })

    if (check.kind === 'invalid') {
      return rerender(request, h, {
        text,
        revision,
        from,
        note: check.note,
        noteProblem: check.noteProblem
      })
    }

    const actor = toActor(request)

    if (actor === undefined) {
      return h.view(
        'event',
        toUnattributedPage(
          key,
          { text, revision, from, note: check.edit.note },
          timesOf(request).zone
        )
      )
    }

    const result = await editPayloadUseCase(key, check.edit, actor)

    if (result.outcome === 'stale') {
      return rerender(request, h, {
        text,
        revision,
        from,
        note: check.edit.note,
        stale: true
      })
    }

    request.yar.flash(redriveNoticeKey, {
      ...result,
      action: 'edit',
      page: toEventHref(key)
    })

    return h.redirect(toRedirect(key, toSafeFrom(from))).code(seeOther)
  }
}
