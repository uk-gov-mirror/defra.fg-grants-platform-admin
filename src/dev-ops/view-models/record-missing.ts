import { statusCodes } from '../../common/status-codes.ts'
import type { RecordType } from './record-type.ts'

/** The three ways a record's page has nothing of the record to show. */
export type MissingState = 'unavailable' | 'timed-out' | 'not-found'

interface Message {
  title: string
  text: string
}

interface MissingCopy {
  unavailable: Message
  timedOut: Message
  notFound: Message
}

/** The address's params, by record: what names it on the page and in its messages. */
export type MissingKey = Record<string, string>

const answeredWithAnError = (source: string) =>
  `${source} answered with an error. Nothing has changed — try again in a moment.`

const versionNotFound = (source: string, { code, version }: MissingKey) => ({
  title: `${source} has no record of ${code}@${version}.`,
  text: `Check the version. If it was published and ${source} rejected it on arrival, its message is in ${source}’s inbox as a dead letter, unless it has been purged.`
})

const copies: Record<string, (key: MissingKey) => MissingCopy> = {
  application: ({ code, clientRef }) => ({
    unavailable: {
      title: 'This application couldn’t be loaded from GAS.',
      text: answeredWithAnError('GAS')
    },
    timedOut: {
      title:
        'This application couldn’t be loaded: GAS timed out waiting for it.',
      text: 'Nothing has changed. Try again in a moment.'
    },
    notFound: {
      title: `GAS has no application ${clientRef} for ${code}.`,
      text: 'Check the reference and the grant — a reference belongs to one grant. Search for it from Applications.'
    }
  }),
  case: ({ caseRef }) => ({
    unavailable: {
      title: 'This case could not be loaded from CW.',
      text: answeredWithAnError('CW')
    },
    timedOut: {
      title: 'This case could not be loaded: CW timed out waiting for it.',
      text: 'Nothing has changed. Refresh to try again.'
    },
    notFound: {
      title: `CW has no case ${caseRef}.`,
      text: 'Check the reference — it may belong to a case that was closed and replaced. Search for it from Cases.'
    }
  }),
  grant: (key) => ({
    unavailable: {
      title: 'This grant could not be loaded from GAS.',
      text: answeredWithAnError('GAS')
    },
    timedOut: {
      title: 'This grant could not be loaded: GAS timed out waiting for it.',
      text: 'Nothing has changed. Refresh to try again.'
    },
    notFound: versionNotFound('GAS', key)
  }),
  workflow: (key) => ({
    unavailable: {
      title: 'This workflow couldn’t be loaded from CW.',
      text: answeredWithAnError('CW')
    },
    timedOut: {
      title: 'This workflow couldn’t be loaded: CW timed out waiting for it.',
      text: 'Nothing has changed. Refresh to try again.'
    },
    notFound: versionNotFound('CW', key)
  })
}

/** A version that was never stored may be a message the service refused: its inbox holds it under the code. */
export interface InboxSearch {
  action: string
  code: string
  text: string
}

export interface RecordMissing {
  state: MissingState
  /** The record's name in its address: the reference, or the config's code. */
  title: string
  /** The browser tab's title. */
  pageTitle: string
  message: Message
  inboxSearch: InboxSearch | null
}

/** A grant's names the inbox; a workflow's the code it searches for too. */
const searchTexts: Record<string, (code: string) => string> = {
  grant: () => 'Search GAS’s inbox',
  workflow: (code) => `Search CW’s inbox for ${code}`
}

const toInboxSearch = (
  record: RecordType,
  key: MissingKey,
  state: MissingState
): InboxSearch | null =>
  state === 'not-found' && key.version !== undefined
    ? {
        action: `/dev-ops/events/${record.source.toLowerCase()}/inbox`,
        code: key.code,
        text: searchTexts[record.itemId](key.code)
      }
    : null

const messageFor = (copy: MissingCopy, state: MissingState): Message =>
  ({
    unavailable: copy.unavailable,
    'timed-out': copy.timedOut,
    'not-found': copy.notFound
  })[state]

/** A config version is named `code@version`, as everywhere it is written. */
const nameOf = (record: RecordType, key: MissingKey): string =>
  key.version === undefined
    ? key[record.titleParam]
    : `${key.code}@${key.version}`

const toPageTitle = (
  record: RecordType,
  key: MissingKey,
  state: MissingState
): string =>
  `${state === 'not-found' ? 'Not found – ' : ''}${record.title} ${nameOf(record, key)}`

export const toRecordMissing = (
  record: RecordType,
  key: MissingKey,
  state: MissingState
): RecordMissing => ({
  state,
  title: key[record.titleParam],
  pageTitle: toPageTitle(record, key, state),
  message: messageFor(copies[record.itemId](key), state),
  inboxSearch: toInboxSearch(record, key, state)
})

/** A record the service could not answer for is no page of it: the status says why. */
export const missingStatusCodes: Record<MissingState, number> = {
  unavailable: statusCodes.serviceUnavailable,
  'timed-out': statusCodes.gatewayTimeout,
  'not-found': statusCodes.notFound
}
