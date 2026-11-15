import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import {
  formMaxBytes,
  toEditNote,
  toEditNoteProblem
} from '../use-cases/edit-payload-command.ts'
import type { PayloadSubmission } from '../use-cases/edit-payload-step.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { toBackBucket } from '../view-models/bucket-nav.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import {
  eventPageCache,
  toSafeFrom
} from '../view-models/event-page.view-model.ts'
import { toPayloadPage } from '../view-models/payload-edit-page.ts'
import { fromMax } from '../view-models/record-filters.ts'
import { timesOf } from '../view-models/times.ts'

/** As the save route bounds it. */
const noteMax = 2000

interface ReviewPayload {
  text: string
  revision: number
  back: string
  step?: string
  retry?: string
  note: string
}

/** A save held back while the event could not be read comes back as the save would have: the note kept, and checked. */
const toSubmission = ({
  text,
  revision,
  back: from,
  step,
  retry,
  note
}: ReviewPayload): PayloadSubmission => {
  if (retry !== 'save') {
    return { text, revision, from, back: step === 'edit' }
  }

  const trimmed = toEditNote(note)

  return {
    text,
    revision,
    from,
    note: trimmed,
    noteProblem: toEditNoteProblem(trimmed)
  }
}

/**
 * Review changes, Back to editing, and Try again on changes the page held
 * while it could not read the event. Nothing is written, so the answer is
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
        back: Joi.string().allow('').max(fromMax).default(''),
        step: Joi.string().valid('edit'),
        retry: Joi.string().valid('save'),
        // Back to editing posts the save form, note and all; only a retried save keeps it.
        note: Joi.string().allow('').max(noteMax).truncate().default('')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = toEventKey(request.params)
    const result = await getEventUseCase(key)
    const submission = toSubmission(request.payload as ReviewPayload)
    const bucket = toBackBucket(
      await getCatalogueUseCase(),
      toSafeFrom(submission.from)
    )

    return h.view(
      'event',
      toPayloadPage(result, key, submission, timesOf(request).zone, bucket)
    )
  }
}
