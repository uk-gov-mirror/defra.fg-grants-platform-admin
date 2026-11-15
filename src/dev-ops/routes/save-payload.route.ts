import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { config } from '../../common/config.ts'
import type { EditPayloadCheck } from '../use-cases/edit-payload-command.ts'
import {
  checkEditPayload,
  formMaxBytes
} from '../use-cases/edit-payload-command.ts'
import type { PayloadSubmission } from '../use-cases/edit-payload-step.ts'
import type { EditResult } from '../use-cases/edit-payload.use-case.ts'
import { editPayloadUseCase } from '../use-cases/edit-payload.use-case.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import type { EventKey, PayloadEdit } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { redriveEventUseCase } from '../use-cases/redrive-event.use-case.ts'
import { toActor } from '../../common/view-models/actor.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import { toEventHref } from '../view-models/event-formats.ts'
import type { EventPageAsks } from '../view-models/event-page.view-model.ts'
import {
  eventBannerId,
  eventPageCache,
  isProduction,
  redriveNoticeKey,
  toEventPage,
  toEventStatusCode,
  toSafeFrom,
  toSubmissionAsks
} from '../view-models/event-page.view-model.ts'
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
  then?: string
}

/** To the banner, which takes focus there: the form posted to `#payload`, which a bare Location would inherit. */
const toRedirect = (key: EventKey, from: string): string => {
  const href = toEventHref(key)
  const query = from === '' ? '' : `?back=${encodeURIComponent(from)}`

  return `${href}${query}#${eventBannerId}`
}

/** The service didn't answer the save: the changes stay on the page, to try again. */
const unanswered = new Set(['timed-out', 'unavailable'])

/** Trimmed, as it is kept for the form or sent. */
const checkedNote = (check: EditPayloadCheck): string =>
  check.kind === 'invalid' ? check.note : check.edit.note

const unattributed = {
  title:
    'Not saved — your account has no name or email to record against this change.',
  text: 'Nothing has changed.'
}

const toHeld = (
  { outcome }: EditResult,
  { then, ...held }: Omit<SavePayload, 'back'>
) => ({ timedOut: outcome === 'timed-out', ...held, then: then ?? '' })

interface Save {
  key: EventKey
  edit: PayloadEdit
  actor: string
  submission: PayloadSubmission & { note: string }
  then: string | undefined
}

/**
 * A stale save is the editor again, one the service didn't answer the held
 * changes; the rest leave their outcome in the session and are followed by a
 * 303.
 */
const save = async (
  request: Request,
  h: ResponseToolkit,
  { key, edit, actor, submission, then }: Save
) => {
  const result = await editPayloadUseCase(key, edit, actor)

  if (result.outcome === 'stale') {
    return viewSubmission(request, h, key, { ...submission, stale: true })
  }

  if (unanswered.has(result.outcome)) {
    return viewSubmission(request, h, key, submission, {
      held: toHeld(result, { ...submission, then })
    })
  }

  request.yar.flash(redriveNoticeKey, {
    ...result,
    action: 'edit',
    page: toEventHref(key),
    redrive: await redriveAfter(result, then, key, actor)
  })

  return h.redirect(toRedirect(key, toSafeFrom(submission.from))).code(seeOther)
}

/** Save and redrive has no single endpoint: the redrive follows a save that went through, and only then. */
const redriveAfter = async (
  { outcome }: EditResult,
  then: string | undefined,
  key: EventKey,
  actor: string
) =>
  outcome === 'saved' && then === 'redrive'
    ? redriveEventUseCase(key, actor)
    : null

/** The page drawn from the posted text: the review, the editor or the held changes. */
const viewSubmission = async (
  request: Request,
  h: ResponseToolkit,
  key: EventKey,
  submission: PayloadSubmission,
  extras: Pick<EventPageAsks, 'held' | 'saveError'> = {}
) => {
  const result = await getEventUseCase(key)
  const page = toEventPage({
    result,
    key,
    times: timesOf(request),
    catalogue: await getCatalogueUseCase(),
    prod: isProduction(config.get('environmentLabel')),
    ...toSubmissionAsks(result, key, submission, extras)
  })

  return h.view('events/event', page).code(toEventStatusCode(page))
}

/**
 * Save, and Save and redrive. The hidden text is read again rather than
 * trusted, since it came back from the browser. A rejected save is the review
 * again, a stale one the editor, an unanswered one the changes held on the
 * page; the rest leave their outcome in the session and are followed by a
 * 303, as redrive and purge are. Save and redrive has no single endpoint, so
 * the redrive follows a save that went through, and only then.
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
        note: Joi.string().allow('').max(noteMax).truncate().default(''),
        then: Joi.string().valid('redrive')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = toEventKey(request.params)
    const {
      text,
      revision,
      back: from,
      note,
      then
    } = request.payload as SavePayload
    const check = checkEditPayload({ text, revision, note })
    const submission = { text, revision, from, note: checkedNote(check) }

    if (check.kind === 'invalid') {
      return viewSubmission(request, h, key, {
        ...submission,
        noteProblem: check.noteProblem
      })
    }

    const actor = toActor(request)

    if (actor === undefined) {
      return viewSubmission(request, h, key, submission, {
        saveError: unattributed
      })
    }

    return save(request, h, {
      key,
      edit: check.edit,
      actor,
      submission,
      then
    })
  }
}
