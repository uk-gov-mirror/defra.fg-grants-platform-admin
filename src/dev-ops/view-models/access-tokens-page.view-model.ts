import { statusCodes } from '../../common/status-codes.ts'
import type {
  ClientService,
  ListResult,
  ListedToken,
  TokenFailure
} from '../use-cases/access-tokens.use-case.ts'
import { toExpiryDay, toUkDate } from './access-token-dates.ts'
import type {
  DialogKind,
  ExpiryGroup,
  ExpiryInput,
  FormRefusal,
  OpenDialog
} from './access-token-forms.ts'
import {
  defaultExpiry,
  toExpiryGroup,
  toFirstOptionId,
  toKeepOldOptions
} from './access-token-forms.ts'
import type {
  TokenAlert,
  TokenNotice,
  TokenToast
} from './access-token-messages.ts'
import { toRefusalToast, toUnavailableAlert } from './access-token-messages.ts'
import type { TokenRow } from './access-token-rows.ts'
import { toTokenRows } from './access-token-rows.ts'
import type { ServiceWords } from './access-token-services.ts'
import {
  serviceWords,
  toClientsPath,
  toNavActive
} from './access-token-services.ts'
import { toServiceName } from './shell.ts'

/** The page a token is never cached on, as it may carry one being revealed. */
export const accessTokensPageCache = { otherwise: 'no-store' }

export const metaSentence =
  'Tokens are stored as SHA-256 hashes; the value is shown once, when it’s issued.'

/** A token just issued, shown once in the response to the POST that made it. */
export interface Reveal {
  clientId: string
  raw: string
  /** After a rotation: the old token, whose drawer stays open behind. */
  rotatedTokenId: string | null
}

/** What the address asked to have open: a token's drawer, and a dialog over it or over the list. */
export interface OpenRequest {
  tokenId: string | null
  dialog: DialogKind | null
}

export interface AccessTokensPageInput {
  service: ClientService
  list: ListResult
  now: Date
  prod: boolean
  requested?: OpenRequest
  dialog?: OpenDialog | null
  reveal?: Reveal | null
  notice?: TokenNotice | null
}

interface SummaryError {
  id: string
  text: string
}

interface Context {
  service: ClientService
  words: ServiceWords
  path: string
  now: Date
  /** The dialog drawn open, if any: the one a POST came back for, or the one the address asked for. */
  open: { kind: DialogKind; tokenId: string | null } | null
  posted: OpenDialog | null
}

const tokenHref = (path: string, tokenId: string, dialog?: DialogKind) =>
  `${path}?token=${tokenId}${dialog ? `&dialog=${dialog}` : ''}`

/** One item when the condition holds, else none: for lists built of optional parts. */
const listIf = <T>(condition: unknown, item: () => T): T[] =>
  condition ? [item()] : []

const isOpen = (
  { open }: Context,
  kind: DialogKind,
  tokenId: string | null
): boolean => open?.kind === kind && open.tokenId === tokenId

const isPostedTo = (
  { posted }: Context,
  kind: DialogKind,
  tokenId: string | null
): boolean => posted?.kind === kind && posted.tokenId === tokenId

interface Posted {
  values: Record<string, string>
  errors: Record<string, string>
  refusal: FormRefusal | null
  active: number
}

const nothingPosted: Posted = {
  values: {},
  errors: {},
  refusal: null,
  active: 0
}

const toPosted = ({ values, errors, refusal, active }: OpenDialog): Posted => ({
  values,
  errors,
  refusal: refusal ?? null,
  active: active ?? 0
})

/** What a posted dialog came back with, only for the dialog it was posted from. */
const postedTo = (
  context: Context,
  kind: DialogKind,
  tokenId: string | null
): Posted =>
  isPostedTo(context, kind, tokenId)
    ? toPosted(context.posted as OpenDialog)
    : nothingPosted

const toExpiryInput = (values: Record<string, string>): ExpiryInput => ({
  expiry: (values.expiry ?? defaultExpiry) as ExpiryInput['expiry'],
  date: values.date ?? ''
})

/** Where an expiry change starts: never, or the token's own date. */
const toCurrentExpiry = (expiresAt: string | null): ExpiryInput =>
  expiresAt === null
    ? { expiry: 'never', date: '' }
    : { expiry: 'custom', date: toUkDate(new Date(expiresAt)) }

/** The expiry choices' errors, in field order, for the summary at the top of the form. */
const expirySummary = (group: ExpiryGroup): SummaryError[] => [
  ...listIf(group.error, () => ({
    id: toFirstOptionId(group.id),
    text: group.error as string
  })),
  ...listIf(group.dateError, () => ({
    id: group.dateId,
    text: group.dateError as string
  }))
]

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`

const toActiveWarning = (clientId: string, active: number): string | null =>
  active > 0
    ? `${clientId} already has ${plural(active, 'active token')}. If this replaces one, rotate that token instead; to add another, issue it again.`
    : null

const newClientId = 'token-new-client'

const toNewClient = ({ values, errors, active }: Posted) => {
  const value = values.clientId ?? ''

  return {
    id: newClientId,
    value,
    error: errors.clientId ?? null,
    warning: toActiveWarning(value.trim(), active)
  }
}

const toNewToken = (context: Context) => {
  const posted = postedTo(context, 'new', null)
  const client = toNewClient(posted)
  const expiry = toExpiryGroup(
    'token-new-expiry',
    toExpiryInput(posted.values),
    posted.errors,
    context.now
  )

  return {
    id: 'token-new',
    formId: 'token-new-form',
    open: isOpen(context, 'new', null),
    action: `${context.path}/tokens`,
    cancelHref: context.path,
    refusal: posted.refusal,
    client,
    expiry,
    // Issuing again for the client it warned about goes ahead.
    hidden: listIf(client.warning, () => ({
      name: 'confirmFor',
      value: client.value.trim()
    })),
    errors: [
      ...listIf(client.error, () => ({
        id: newClientId,
        text: client.error as string
      })),
      ...expirySummary(expiry)
    ]
  }
}

const sameExpiry = (expiresAt: string | null): string =>
  expiresAt === null ? 'never expires' : toExpiryDay(new Date(expiresAt))

interface TokenContext extends Context {
  row: TokenRow
  id: string
  action: string
  cancelHref: string
}

/** What every dialog of a token has: its ids, where it posts and goes back to, and whether it's open. */
const toTokenDialog = (context: TokenContext, kind: DialogKind) => ({
  id: `${context.id}-${kind}`,
  formId: `${context.id}-${kind}-form`,
  open: isOpen(context, kind, context.row.tokenId),
  action: `${context.action}/${kind}`,
  cancelHref: context.cancelHref
})

const toKeepOldReason = ({ row, words }: TokenContext) =>
  row.inUse ? { reason: words.inUse.keepOld } : null

const toRotate = (context: TokenContext) => {
  const { values, refusal } = postedTo(context, 'rotate', context.row.tokenId)

  return {
    ...toTokenDialog(context, 'rotate'),
    refusal,
    sameExpiry: sameExpiry(context.row.expiresAt),
    keepOld: {
      id: `${context.id}-keep`,
      options: toKeepOldOptions(toKeepOldReason(context), values.keepOld)
    }
  }
}

/** A dialog handed back starts where it was left; a fresh one, where the token is. */
const toExpiryStart = (context: TokenContext, posted: Posted): ExpiryInput =>
  isPostedTo(context, 'expiry', context.row.tokenId)
    ? toExpiryInput(posted.values)
    : toCurrentExpiry(context.row.expiresAt)

const toChangeExpiry = (context: TokenContext) => {
  const { row, id, now } = context
  const posted = postedTo(context, 'expiry', row.tokenId)
  const expiry = toExpiryGroup(
    `${id}-expiry-choice`,
    toExpiryStart(context, posted),
    posted.errors,
    now
  )

  return {
    ...toTokenDialog(context, 'expiry'),
    refusal: posted.refusal,
    currently: sameExpiry(row.expiresAt),
    expiry,
    hidden: [{ name: 'hint', value: row.hint ?? '' }],
    errors: expirySummary(expiry)
  }
}

const toRevoke = (context: TokenContext) => {
  const { row } = context
  const { values, errors, refusal } = postedTo(context, 'revoke', row.tokenId)

  return {
    ...toTokenDialog(context, 'revoke'),
    refusal,
    hidden: [{ name: 'hint', value: row.hint ?? '' }],
    typed: values.confirmText ?? null,
    typedError: errors.confirm ?? null
  }
}

const toDelete = (context: TokenContext) => ({
  ...toTokenDialog(context, 'delete'),
  refusal: postedTo(context, 'delete', context.row.tokenId).refusal
})

/**
 * A button in the drawer: the address that opens its dialog without a
 * script, and the dialog it opens with one. Null when the token hasn't the
 * action; the dialog null when the address mustn't open it.
 */
const toAction = <T>(
  context: TokenContext,
  kind: DialogKind,
  offered: boolean,
  dialog: (() => T) | null
) =>
  offered
    ? {
        href: tokenHref(context.path, context.row.tokenId, kind),
        opens: `${context.id}-${kind}`,
        dialog: dialog?.() ?? null
      }
    : null

const noActionsNote =
  'This token has no valid client ID, so it can’t be changed here.'

/** What the drawer says above the facts: who calls with the token in use, or why a token has no actions. */
const toNotes = (row: TokenRow, words: ServiceWords) => ({
  inUseNote: row.inUse && row.actions.revoke ? words.inUse : null,
  noActionsNote: row.clientId === null ? noActionsNote : null
})

type TokenDialogs = Record<
  Exclude<DialogKind, 'new'>,
  { dialog: unknown } | null
>

/**
 * A refusal whose dialog isn't drawn any more, said at the top of the
 * token's drawer: the token changed state while the dialog was open (revoked
 * before a rotation, revived before a delete), so the fresh list no longer
 * offers that action.
 */
const isDrawn = (dialogs: TokenDialogs, kind: Exclude<DialogKind, 'new'>) =>
  Boolean(dialogs[kind]?.dialog)

const isPostedForToken = (
  posted: OpenDialog | null,
  tokenId: string
): posted is OpenDialog & { kind: Exclude<DialogKind, 'new'> } =>
  posted !== null && posted.kind !== 'new' && posted.tokenId === tokenId

const toDrawerRefusal = (
  { posted }: Context,
  tokenId: string,
  dialogs: TokenDialogs
): FormRefusal | null =>
  isPostedForToken(posted, tokenId) && !isDrawn(dialogs, posted.kind)
    ? (posted.refusal ?? null)
    : null

const toTokenView = (
  row: TokenRow,
  context: Context,
  openTokenId: string | null
) => {
  const id = `token-${row.tokenId}`
  const tokenContext: TokenContext = {
    ...context,
    row,
    id,
    action: `${context.path}/${row.clientId}/tokens/${row.tokenId}`,
    cancelHref: tokenHref(context.path, row.tokenId)
  }
  const { actions } = row
  const dialogs = {
    rotate: toAction(tokenContext, 'rotate', actions.rotate, () =>
      toRotate(tokenContext)
    ),
    expiry: toAction(tokenContext, 'expiry', actions.expiry, () =>
      toChangeExpiry(tokenContext)
    ),
    // The token in use is never revoked: its button is off, and it has no dialog for the address to open.
    revoke: toAction(
      tokenContext,
      'revoke',
      actions.revoke,
      row.inUse ? null : () => toRevoke(tokenContext)
    ),
    delete: toAction(tokenContext, 'delete', actions.delete, () =>
      toDelete(tokenContext)
    )
  }

  return {
    ...row,
    id,
    href: tokenHref(context.path, row.tokenId),
    open: openTokenId === row.tokenId,
    closeHref: context.path,
    ...toNotes(row, context.words),
    ...dialogs,
    refusal: toDrawerRefusal(context, row.tokenId, dialogs)
  }
}

export type TokenView = ReturnType<typeof toTokenView>

const isListed = (tokens: ListedToken[], tokenId: string | null): boolean =>
  tokens.some((token) => token.tokenId === tokenId)

/** A dialog handed back opens again, unless its token has gone. */
const toPostedOpen = (
  { kind, tokenId }: OpenDialog,
  tokens: ListedToken[]
): Context['open'] =>
  kind === 'new' || isListed(tokens, tokenId) ? { kind, tokenId } : null

/** New token needs no token; any other dialog the address asks for, a listed one. */
const isOpenable = (
  { dialog, tokenId }: OpenRequest,
  tokens: ListedToken[]
): boolean => dialog !== null && (dialog === 'new' || isListed(tokens, tokenId))

const toRequestedOpen = (
  requested: OpenRequest,
  tokens: ListedToken[]
): Context['open'] =>
  isOpenable(requested, tokens)
    ? {
        kind: requested.dialog as DialogKind,
        tokenId: requested.dialog === 'new' ? null : requested.tokenId
      }
    : null

const nothingRequested: OpenRequest = { tokenId: null, dialog: null }

const toOpen = (
  input: AccessTokensPageInput,
  tokens: ListedToken[]
): Context['open'] =>
  input.dialog
    ? toPostedOpen(input.dialog, tokens)
    : toRequestedOpen(input.requested ?? nothingRequested, tokens)

const toDrawerCandidates = (
  input: AccessTokensPageInput,
  open: Context['open']
) => [open?.tokenId, input.reveal?.rotatedTokenId, input.requested?.tokenId]

/** The drawer open on arrival: the token a dialog is over, the one just rotated, or the one the address names. */
const toOpenTokenId = (
  input: AccessTokensPageInput,
  tokens: ListedToken[],
  open: Context['open']
): string | null =>
  toDrawerCandidates(input, open).find(
    (tokenId): tokenId is string =>
      typeof tokenId === 'string' && isListed(tokens, tokenId)
  ) ?? null

const toTokenRefusal = (dialog: OpenDialog | null | undefined) =>
  dialog?.refusal && dialog.tokenId !== null
    ? { refusal: dialog.refusal, tokenId: dialog.tokenId }
    : null

/** A refusal for a token the fresh list no longer has: there is no dialog left to show it in. */
const toOrphanToast = (
  dialog: OpenDialog | null | undefined,
  tokens: ListedToken[] | null
): TokenToast | null => {
  const orphan = toTokenRefusal(dialog)

  return orphan && !isListed(tokens ?? [], orphan.tokenId)
    ? toRefusalToast(orphan.refusal)
    : null
}

interface PageAlert {
  tone: 'danger' | 'warning'
  title: string
  text: string
  retryHref?: string
  /** A notice after a write is news, so it takes the focus. */
  focusOnArrival: boolean
}

const toListAlert = (
  failure: TokenFailure,
  service: ClientService,
  path: string
): PageAlert => {
  const { retry, ...alert } = toUnavailableAlert(failure, service)

  return {
    ...alert,
    ...(retry ? { retryHref: path } : {}),
    focusOnArrival: false
  }
}

const toAlerts = (input: AccessTokensPageInput, path: string): PageAlert[] => [
  ...listIf(input.list.outcome !== 'done', () =>
    toListAlert(input.list as TokenFailure, input.service, path)
  ),
  ...listIf(input.notice?.alert, () => ({
    ...(input.notice?.alert as TokenAlert),
    focusOnArrival: true
  }))
]

const offersTokens = (list: ListResult): boolean =>
  list.outcome !== 'not-offered'

/** No New token where GAS offers no tokens. */
const toOfferedNewToken = (list: ListResult, context: Context) =>
  offersTokens(list) ? toNewToken(context) : null

const toReveal = (reveal: Reveal | null | undefined, path: string) =>
  reveal
    ? {
        id: 'token-issued',
        clientId: reveal.clientId,
        raw: reveal.raw,
        doneHref: reveal.rotatedTokenId
          ? tokenHref(path, reveal.rotatedTokenId)
          : path
      }
    : null

const toToasts = (
  input: AccessTokensPageInput,
  tokens: ListedToken[] | null
): TokenToast[] => {
  const toast = input.notice?.toast ?? toOrphanToast(input.dialog, tokens)

  return toast ? [toast] : []
}

const tokensOf = (list: ListResult): ListedToken[] | null =>
  list.outcome === 'done' ? list.tokens : null

/** 503 for a list that couldn't be read, as a record that couldn't; a GAS that offers no tokens is no failure. */
export const toListStatus = (list: ListResult): number =>
  list.outcome === 'done' || !offersTokens(list)
    ? statusCodes.ok
    : statusCodes.serviceUnavailable

const toContext = (
  input: AccessTokensPageInput,
  listed: ListedToken[]
): Context => ({
  service: input.service,
  words: serviceWords[input.service],
  path: toClientsPath(input.service),
  now: input.now,
  open: toOpen(input, listed),
  posted: input.dialog ?? null
})

export const toAccessTokensPage = (input: AccessTokensPageInput) => {
  const { service, now } = input
  const tokens = tokensOf(input.list)
  const context = toContext(input, tokens ?? [])
  const { words, path } = context
  const openTokenId = toOpenTokenId(input, tokens ?? [], context.open)

  return {
    pageTitle: `${words.short} access tokens`,
    service,
    navActive: toNavActive(service),
    path,
    shortName: words.short,
    meta: [toServiceName(words.short), metaSentence],
    prod: input.prod,
    newHref: `${path}?dialog=new`,
    alerts: toAlerts(input, path),
    tokens:
      tokens &&
      toTokenRows(tokens, { now, words }).map((row) =>
        toTokenView(row, context, openTokenId)
      ),
    newToken: toOfferedNewToken(input.list, context),
    openTokenId,
    reveal: toReveal(input.reveal, path),
    toasts: toToasts(input, tokens)
  }
}
