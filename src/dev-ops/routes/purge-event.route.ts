import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventDetail, EventKey } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import type { PurgeResult } from '../use-cases/purge-event.use-case.ts'
import { purgeEventUseCase } from '../use-cases/purge-event.use-case.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import { toEventHref } from '../view-models/event-formats.ts'
import {
  eventBannerId,
  purgeFormKey,
  redriveNoticeKey,
  toSafeFrom
} from '../view-models/event-page.view-model.ts'
import { isDeadLetterStatus } from '../view-models/event-state.ts'
import { toPurgeFormError, toPurgeNote } from '../view-models/purge-form.ts'
import { toActor } from '../../common/view-models/actor.ts'
import { seeOther } from '../view-models/see-other.ts'
import { fromMax } from '../view-models/record-filters.ts'

/** Long enough for any code the backends may add, short enough to be a code. */
const reasonMax = 64

/** Four times the limit the form enforces: past 500 is the operator's mistake, and the note is cut here so a pasted payload never reaches the session. */
const noteMax = 2000

interface PurgePayload {
  back: string
  reasonCode: string
  note: string
}

const toQuery = (from: string, reopen: boolean): string => {
  const params = new URLSearchParams()

  if (from !== '') {
    params.set('back', from)
  }

  if (reopen) {
    params.set('confirm', 'purge')
  }

  return params.size ? `?${params}` : ''
}

/** A rejected form is handed back in the dialog, drawn open; a purge lands on the banner that says how it went. */
const toRedirect = (key: EventKey, from: string, reopen: boolean): string =>
  `${toEventHref(key)}${toQuery(from, reopen)}${reopen ? '' : `#${eventBannerId}`}`

/** The same gate the page draws the button behind. */
const isPurgeable = (event: EventDetail): boolean =>
  isDeadLetterStatus(event.status) && (event.purgeDeletionDate ?? null) !== null

/**
 * The gate again, for the tab that has been open since before the event moved
 * on. The fence is the backend's; this only keeps the answer honest, since a
 * purge of an event that is no longer dead-lettered comes back as a 404 the
 * operator would read as "the event is gone".
 *
 * A read that did not land says nothing about the event, so it purges: the
 * backend refuses it if it must.
 */
const toStaleOutcome = async (key: EventKey): Promise<PurgeResult | null> => {
  const { outcome, event } = await getEventUseCase(key)

  return outcome === 'found' && event !== null && !isPurgeable(event)
    ? { outcome: 'conflict', status: event.statusLabel }
    : null
}

/**
 * No CSRF token and no `options.auth`, for the reasons the redrive route
 * spells out. The form is checked here as well as in the backends because this
 * is the only place that can put the operator back in front of what they typed.
 */
export const purgeEventRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/{service}/{box}/{id}/purge',
  options: {
    validate: {
      params: Joi.object(eventAddress),
      payload: Joi.object({
        back: Joi.string().allow('').max(fromMax).default(''),
        // Bounded, not checked: an unknown code is "no reason chosen", which
        // is a sentence on the page rather than a 400 in front of it.
        reasonCode: Joi.string().allow('').max(reasonMax).default(''),
        // Truncated rather than refused: a pasted payload is a note to
        // shorten, and the form can only say so with the note in front of it.
        note: Joi.string().allow('').max(noteMax).truncate().default('')
      })
        .empty(null)
        // Spelled out rather than `{}`: an object default is taken as written,
        // so its children's defaults never fire on the body-less POST hapi
        // hands a payload of `null`.
        .default({ back: '', reasonCode: '', note: '' })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = toEventKey(request.params)
    const { back: from, reasonCode, note } = request.payload as PurgePayload
    const page = toEventHref(key)
    const submission = { reasonCode, note: toPurgeNote(note) }
    const error = toPurgeFormError(submission)
    const safeFrom = toSafeFrom(from)

    if (error !== null) {
      request.yar.flash(purgeFormKey, { ...submission, error, page })

      return h.redirect(toRedirect(key, safeFrom, true)).code(seeOther)
    }

    const result =
      (await toStaleOutcome(key)) ??
      (await purgeEventUseCase(key, submission, toActor(request)))

    request.yar.flash(redriveNoticeKey, { ...result, action: 'purge', page })

    return h.redirect(toRedirect(key, safeFrom, false)).code(seeOther)
  }
}
