import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute
} from '@hapi/hapi'
import Joi from 'joi'

import { config } from '../../common/config.ts'
import type {
  ClientService,
  IssueResult,
  KeepOld,
  TokenFailure,
  TokenKey
} from '../use-cases/access-tokens.use-case.ts'
import {
  changeTokenExpiryUseCase,
  deleteAccessTokenUseCase,
  issueAccessTokenUseCase,
  listAccessTokensUseCase,
  revokeAccessTokenUseCase,
  rotateAccessTokenUseCase
} from '../use-cases/access-tokens.use-case.ts'
import type {
  DialogKind,
  ExpiryInput,
  NewTokenInput,
  OpenDialog
} from '../view-models/access-token-forms.ts'
import {
  clientNamePattern,
  confirmsRevoke,
  dialogKinds,
  expiryChoiceValues,
  formStatus,
  keepOldValues,
  parseExpiry,
  parseNewToken,
  revokeMismatch,
  toExpiryFieldErrors,
  toIssueFieldErrors
} from '../view-models/access-token-forms.ts'
import type {
  TokenAction,
  TokenNotice
} from '../view-models/access-token-messages.ts'
import {
  accessTokenNoticeKey,
  deletedToast,
  toExpiryToast,
  toNoticeFor,
  toRefusal,
  toRevokedToast,
  toUnknownAlert,
  isUncertain
} from '../view-models/access-token-messages.ts'
import {
  clientServices,
  toClientsPath
} from '../view-models/access-token-services.ts'
import type {
  OpenRequest,
  Reveal
} from '../view-models/access-tokens-page.view-model.ts'
import {
  accessTokensPageCache,
  toAccessTokensPage,
  toListStatus
} from '../view-models/access-tokens-page.view-model.ts'
import { seeOther } from '../view-models/see-other.ts'
import { shellQuery } from '../view-models/times.ts'

const service = Joi.string()
  .valid(...clientServices)
  .required()

const serviceParams = Joi.object({ service })

const tokenId = Joi.string().hex().length(24)

const tokenParams = Joi.object({
  service,
  clientId: Joi.string().pattern(clientNamePattern).required(),
  tokenId: tokenId.required()
})

/** What the page is asked to open, besides what the shell asks of every page. */
const openQuery = Joi.object({
  token: tokenId,
  dialog: Joi.string().valid(...dialogKinds),
  ...shellQuery
})

/** Read only for the words of a toast, never for the write itself. */
const hint = Joi.string()
  .pattern(/^[A-Za-z0-9_-]{4}$/)
  .allow('')
  .default('')

const expiryFields = {
  expiry: Joi.string()
    .valid(...expiryChoiceValues)
    .required(),
  date: Joi.string().allow('').max(10).default('')
}

const serviceOf = (request: Request): ClientService =>
  (request.params as { service: ClientService }).service

const tokenKeyOf = (request: Request): TokenKey =>
  request.params as unknown as TokenKey

interface PageExtras {
  requested?: OpenRequest
  dialog?: OpenDialog
  reveal?: Reveal
  notice?: TokenNotice | null
}

/**
 * Every page this answers carries no-store: a reveal holds a live token, and
 * an error is drawn beside a list that may have changed since.
 */
const renderPage = async (
  request: Request,
  h: ResponseToolkit,
  extras: PageExtras,
  code?: number
): Promise<ResponseObject> => {
  const shown = serviceOf(request)
  const list = await listAccessTokensUseCase(shown)
  const page = toAccessTokensPage({
    service: shown,
    list,
    now: new Date(),
    prod: config.get('environmentLabel') === 'prod',
    ...extras
  })
  const status = code ?? toListStatus(list)

  return h
    .view('access-tokens', page)
    .code(status)
    .header('cache-control', 'no-store')
}

/** The same page, with the dialog open again on what was wrong: 400, or 200 for a warning that isn't an error. */
const reopen = (
  request: Request,
  h: ResponseToolkit,
  dialog: OpenDialog,
  code: number = formStatus.refused
) => renderPage(request, h, { dialog }, code)

/**
 * The page the write came from, and nothing about the outcome in the url:
 * the outcome rides the session instead, spent on one render.
 */
const backTo = (
  request: Request,
  h: ResponseToolkit,
  notice: TokenNotice,
  to: string
) => {
  request.yar.flash(accessTokenNoticeKey)
  request.yar.flash(accessTokenNoticeKey, notice)

  return h.redirect(to).code(seeOther)
}

const tokenPage = ({ service: shown, tokenId: id }: TokenKey): string =>
  `${toClientsPath(shown)}?token=${id}`

const dialogOf: Record<TokenAction, DialogKind> = {
  issue: 'new',
  rotate: 'rotate',
  expiry: 'expiry',
  revoke: 'revoke',
  delete: 'delete'
}

/**
 * A write that may have happened goes back to the list, saying so; any other
 * failure opens its dialog again with the refusal, or, if the list no longer
 * has the token, says it in a toast.
 */
const afterFailure = (
  request: Request,
  h: ResponseToolkit,
  action: TokenAction,
  failure: TokenFailure,
  {
    tokenId: id = null,
    values = {}
  }: { tokenId?: string | null; values?: Record<string, string> }
) => {
  const shown = serviceOf(request)

  return isUncertain(failure)
    ? backTo(
        request,
        h,
        { service: shown, alert: toUnknownAlert(action, shown, failure) },
        toClientsPath(shown)
      )
    : reopen(request, h, {
        kind: dialogOf[action],
        tokenId: id,
        values,
        errors: {},
        refusal: toRefusal(action, failure, shown)
      })
}

/** The response to the POST that issued a token is the one place its value appears. */
const toReveal = (
  request: Request,
  h: ResponseToolkit,
  clientId: string,
  result: Extract<IssueResult, { outcome: 'issued' }>,
  rotatedTokenId: string | null = null
) =>
  renderPage(request, h, {
    reveal: {
      clientId: result.token.clientId ?? clientId,
      raw: result.raw,
      rotatedTokenId
    }
  })

export const viewAccessTokensRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/clients/{service}',
  options: {
    cache: accessTokensPageCache,
    validate: { params: serviceParams, query: openQuery }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { token, dialog } = request.query as {
      token?: string
      dialog?: DialogKind
    }
    // Read before the list, so the message is spent whatever the read says.
    const [notice] = request.yar.flash(accessTokenNoticeKey)

    return renderPage(request, h, {
      requested: { tokenId: token ?? null, dialog: dialog ?? null },
      notice: toNoticeFor(notice, serviceOf(request))
    })
  }
}

const issueRefused = (
  request: Request,
  h: ResponseToolkit,
  values: NewTokenInput,
  failure: TokenFailure
) => {
  const errors =
    failure.outcome === 'refused'
      ? toIssueFieldErrors(failure.errorCode, values.expiry)
      : null

  return errors
    ? reopen(request, h, {
        kind: 'new',
        tokenId: null,
        values: { ...values },
        errors
      })
    : afterFailure(request, h, 'issue', failure, { values: { ...values } })
}

/** Creates the client too when no token has its name yet. */
export const issueAccessTokenRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/clients/{service}/tokens',
  options: {
    validate: {
      params: serviceParams,
      payload: Joi.object({
        clientId: Joi.string().allow('').max(200).required(),
        confirmFor: Joi.string().allow('').max(200).default(''),
        ...expiryFields
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const values = request.payload as NewTokenInput
    const parsed = parseNewToken(values, new Date())

    if (!parsed.ok) {
      return reopen(request, h, {
        kind: 'new',
        tokenId: null,
        values: { ...values },
        errors: parsed.errors
      })
    }

    const { clientId, expiresAt } = parsed.value
    const result = await issueAccessTokenUseCase(serviceOf(request), clientId, {
      expiresAt,
      confirmed: values.confirmFor === clientId
    })

    if (result.outcome === 'issued') {
      return toReveal(request, h, clientId, result)
    }

    return result.outcome === 'has-active'
      ? reopen(
          request,
          h,
          {
            kind: 'new',
            tokenId: null,
            values: { ...values, clientId },
            errors: {},
            active: result.active
          },
          formStatus.warned
        )
      : issueRefused(request, h, values, result)
  }
}

export const rotateAccessTokenRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/rotate',
  options: {
    validate: {
      params: tokenParams,
      payload: Joi.object({
        keepOld: Joi.string()
          .valid(...keepOldValues)
          .required()
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = tokenKeyOf(request)
    const { keepOld } = request.payload as { keepOld: KeepOld }
    const result = await rotateAccessTokenUseCase(key, keepOld)

    return result.outcome === 'issued'
      ? toReveal(request, h, key.clientId, result, key.tokenId)
      : afterFailure(request, h, 'rotate', result, {
          tokenId: key.tokenId,
          values: { keepOld }
        })
  }
}

interface ExpiryPayload extends ExpiryInput {
  hint: string
}

/** The expiry the token has now, from the service rather than the form: a date left on its day keeps it to the second. */
const currentExpiryOf = async (key: TokenKey): Promise<string> => {
  const list = await listAccessTokensUseCase(key.service)
  const tokens = list.outcome === 'done' ? list.tokens : []

  return tokens.find(({ tokenId: id }) => id === key.tokenId)?.expiresAt ?? ''
}

/** A refused date comes back on its field; any other failure, as any write's. */
const expiryRefused = (
  request: Request,
  h: ResponseToolkit,
  values: { expiry: string; date: string },
  failure: TokenFailure
) => {
  const { tokenId: id } = tokenKeyOf(request)
  const errors =
    failure.outcome === 'refused'
      ? toExpiryFieldErrors(failure.errorCode, values.expiry)
      : null

  return errors
    ? reopen(request, h, { kind: 'expiry', tokenId: id, values, errors })
    : afterFailure(request, h, 'expiry', failure, { tokenId: id, values })
}

export const changeTokenExpiryRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/expiry',
  options: {
    validate: {
      params: tokenParams,
      payload: Joi.object({
        ...expiryFields,
        hint
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = tokenKeyOf(request)
    const payload = request.payload as ExpiryPayload
    const values = { expiry: payload.expiry, date: payload.date }
    const parsed = parseExpiry(
      { ...payload, current: await currentExpiryOf(key) },
      new Date()
    )

    if (!parsed.ok) {
      return reopen(request, h, {
        kind: 'expiry',
        tokenId: key.tokenId,
        values,
        errors: parsed.errors
      })
    }

    const result = await changeTokenExpiryUseCase(key, parsed.value)

    return result.outcome === 'done'
      ? backTo(
          request,
          h,
          {
            service: key.service,
            toast: toExpiryToast(result.token.expiresAt)
          },
          tokenPage(key)
        )
      : expiryRefused(request, h, values, result)
  }
}

export const revokeAccessTokenRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/revoke',
  options: {
    validate: {
      params: tokenParams,
      payload: Joi.object({
        confirmText: Joi.string().allow('').max(200).default(''),
        hint
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = tokenKeyOf(request)
    const { confirmText, hint: shown } = request.payload as {
      confirmText: string
      hint: string
    }

    if (!confirmsRevoke(confirmText, key.clientId)) {
      return reopen(request, h, {
        kind: 'revoke',
        tokenId: key.tokenId,
        values: { confirmText },
        errors: { confirm: revokeMismatch }
      })
    }

    const result = await revokeAccessTokenUseCase(key)

    return result.outcome === 'done'
      ? backTo(
          request,
          h,
          { service: key.service, toast: toRevokedToast(shown || null) },
          tokenPage(key)
        )
      : afterFailure(request, h, 'revoke', result, { tokenId: key.tokenId })
  }
}

/** A POST, as a form can't send a DELETE; it becomes one on the way to GAS. */
export const deleteAccessTokenRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/clients/{service}/{clientId}/tokens/{tokenId}/delete',
  options: {
    validate: { params: tokenParams }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = tokenKeyOf(request)
    const result = await deleteAccessTokenUseCase(key)

    return result.outcome === 'done'
      ? backTo(
          request,
          h,
          { service: key.service, toast: deletedToast },
          toClientsPath(key.service)
        )
      : afterFailure(request, h, 'delete', result, { tokenId: key.tokenId })
  }
}

export const accessTokenWriteRoutes = [
  issueAccessTokenRoute,
  rotateAccessTokenRoute,
  changeTokenExpiryRoute,
  revokeAccessTokenRoute,
  deleteAccessTokenRoute
]
