import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { editPayloadUseCase } from '../use-cases/edit-payload.use-case.ts'
import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { toActor } from '../view-models/actor.ts'
import { eventAddress } from '../view-models/event-address.ts'
import { toEventHref } from '../view-models/event-formats.ts'
import {
  eventBannerId,
  eventPageCache,
  redriveNoticeKey,
  toSafeFrom
} from '../view-models/event-page.view-model.ts'
import type { PayloadSubmission } from '../view-models/payload-edit-page.ts'
import { toPayloadPage } from '../view-models/payload-edit-page.ts'
import {
  formMaxBytes,
  readPayload,
  toEditNote,
  toEditNoteError,
  toEditText
} from '../view-models/payload-form.ts'

const seeOther = 303

/** Longer than any query this app builds for itself, and still bounded. */
const fromMax = 2048

/** Four times the limit the form enforces: past 500 is the operator's mistake, to be shown with the note in front of them. */
const noteMax = 2000

interface SavePayload {
  text: string
  revision: number
  from: string
  note: string
}

/** To the banner, which takes focus there: the form posted to `#payload`, which a bare Location would inherit. */
const toRedirect = (key: EventKey, from: string): string => {
  const href = toEventHref(key)
  const query = from === '' ? '' : `?from=${encodeURIComponent(from)}`

  return `${href}${query}#${eventBannerId}`
}

/**
 * A rejected save is the review again, re-rendered from the posted text with
 * the note kept and the reason beside it, for the same reason the review is
 * rendered rather than redirected to. A stale one is the editor again, with
 * the text kept.
 */
const rerender = async (
  request: Request,
  h: ResponseToolkit,
  submission: PayloadSubmission
) => {
  const key = request.params as unknown as EventKey
  const result = await getEventUseCase(key)

  if (result.outcome === 'not-found') {
    return h.view('event-not-found', {
      pageTitle: 'Event not found',
      backHref: `/dev-ops/events${toSafeFrom(submission.from)}`
    })
  }

  return h.view('event', {
    pageTitle: 'Event',
    ...toPayloadPage(result, key, submission)
  })
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
        from: Joi.string().allow('').max(fromMax).default(''),
        // Truncated rather than refused: a pasted payload is a note to
        // shorten, and the form can only say so with the note in front of it.
        note: Joi.string().allow('').max(noteMax).truncate().default('')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as EventKey
    const { text, revision, from, note } = request.payload as SavePayload
    const read = readPayload(toEditText(text))
    const trimmed = toEditNote(note)
    const noteError = toEditNoteError(trimmed)

    if (read.kind === 'refused' || noteError !== null) {
      return rerender(request, h, {
        text,
        revision,
        from,
        note: trimmed,
        noteError
      })
    }

    const result = await editPayloadUseCase(
      key,
      { payload: read.value, note: trimmed, revision },
      toActor(request)
    )

    if (result.outcome === 'stale') {
      return rerender(request, h, { text, revision, from, stale: true })
    }

    request.yar.flash(redriveNoticeKey, {
      ...result,
      action: 'edit',
      page: toEventHref(key)
    })

    return h.redirect(toRedirect(key, toSafeFrom(from))).code(seeOther)
  }
}
