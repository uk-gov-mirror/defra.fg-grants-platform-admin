import type {
  DefinitionFile,
  VersionSummary
} from '../use-cases/definition-fetches.ts'
import type { RecordSectionError } from '../use-cases/record-reads.ts'
import type { DefinitionFetchFlash } from './definition-fetch.ts'
import {
  toSectionError,
  toTabHref,
  toTooLarge
} from './record-page.view-model.ts'
import { toVersionPath } from './record-type.ts'
import type { RecordType } from './record-type.ts'
import { toBackHref } from './record-view.ts'
import type { TimeText, Times } from './times.ts'
import { toTime } from './times.ts'
import {
  canFetch,
  toFetchOutcome,
  toFileAlerts,
  versionCopies
} from './version-alerts.ts'
import type {
  AlertAction,
  Toast,
  VersionAlert,
  VersionKind
} from './version-alerts.ts'
import { fileNames, toStoredState } from './version-files.ts'
import type { VersionFiles, VersionFileType } from './version-files.ts'

/** A grant's or a workflow's version, as GAS heads either page. */
export interface VersionHeader extends VersionFiles {
  status: VersionSummary['status']
  receivedAt: string
  /** Newest first. */
  versions: VersionSummary[]
}

/** One tab: the read it needs, and the file it shows (null for a tab that needs none). */
export interface VersionTab {
  id: string
  label: string
  read: string
  file: VersionFileType | null
}

/** In place of a tab's own content, when there is none to show. */
export type TabState =
  | { kind: 'waiting'; text: string; action: AlertAction | null }
  | { kind: 'failed'; title: string; text: string }
  | { kind: 'error'; title: string; text: string }
  | { kind: 'too-large'; text: string }

export interface FetchForm {
  id: string
  action: string
  hidden: { name: string; value: string }[]
}

export interface VersionPageShell {
  pageTitle: string
  backHref: string
  navActive: string
  title: string
  status: { text: string; tone: 'success' | 'neutral' }
  switcher: {
    text: string
    label: string
    items: { text: string; href: string; checked: boolean }[]
  }
  tabs: { text: string; href: string; current: boolean }[]
  tabsLabel: string
  tab: string
  /** Under the header, the most pressing first. */
  alerts: VersionAlert[]
  /** The one form every Fetch button on the page submits; null when nothing can be fetched. */
  fetchForm: FetchForm | null
  /** This page as it is: a Refresh or a Try again. */
  selfHref: string
  toasts: Toast[]
  tabState: TabState | null
  received: TimeText | null
}

const statuses: Record<VersionSummary['status'], VersionPageShell['status']> = {
  active: { text: 'Active', tone: 'success' },
  draft: { text: 'Draft', tone: 'neutral' }
}

/** The list each kind of version is listed in, by its catalogue id. */
const ownLists: Record<VersionKind, string> = {
  grant: 'gas.grants',
  workflow: 'cw.workflows'
}

/** What each tab shows once its file is stored. */
const waitingTexts: Record<string, string> = {
  'grant:phases':
    'The phases and statuses appear once the grant definition is stored.',
  'grant:questions':
    'The questions appear once the grant definition is stored.',
  'grant:actions': 'The actions appear once the grant definition is stored.',
  'grant:entitlements':
    'The entitlement templates appear once the grant definition is stored.',
  'grant:agreement': 'The agreement definition appears once it is stored.',
  'grant:payment': 'The payment definition appears once it is stored.',
  'grant:raw': 'The stored grant definition appears here once it is stored.',
  'workflow:phases':
    'The statuses and moves appear once the workflow definition is stored.',
  'workflow:tasks':
    'The task groups appear once the workflow definition is stored.',
  'workflow:pages':
    'The case pages appear once the workflow definition is stored.',
  'workflow:integrations':
    'The external actions appear once the workflow definition is stored.',
  'workflow:raw':
    'The stored workflow definition appears here once it is stored.'
}

/** Why a Failed file's tab is empty, and what it stops. */
const failedTexts: Record<VersionFileType, string> = {
  grant: 'GAS won’t use this version. Publish a fixed version.',
  agreement:
    'GAS won’t use this agreement definition. Publish a fixed version.',
  payment:
    'Payments for this version will fail: GAS has no fallback for a payment definition. Publish a fixed version.',
  workflow: 'CW won’t use this definition. Publish a fixed version.'
}

/** GAS's cap on a tab's document is 1 MiB; CW says only that the workflow is too large. */
const tooLargeTexts: Record<VersionKind, (file: string) => string> = {
  grant: (file) =>
    `The stored ${file} is larger than 1 MiB, the most this page shows.`,
  workflow: (file) => `The stored ${file} is too large to show here.`
}

const fileWord = (type: VersionFileType): string =>
  fileNames[type].toLowerCase()

interface TabStateInput {
  kind: VersionKind
  header: VersionHeader
  tab: VersionTab
  sectionErrors: RecordSectionError[]
}

/** The same button as the alert above it: Try again after a failed fetch. */
const toWaitingAction = (
  kind: VersionKind,
  header: VersionHeader,
  file: DefinitionFile
): AlertAction | null => {
  if (!canFetch(header)) {
    return null
  }

  return toStoredState(file) === 'Fetch error'
    ? versionCopies[kind].retry
    : versionCopies[kind].fetch
}

const toUnstoredState = (
  { kind, header, tab }: TabStateInput,
  type: VersionFileType,
  file: DefinitionFile
): TabState =>
  toStoredState(file) === 'Failed'
    ? {
        kind: 'failed',
        title: `The ${fileWord(type)} failed, so this tab can’t be shown.`,
        text: failedTexts[type]
      }
    : {
        kind: 'waiting',
        text: waitingTexts[`${kind}:${tab.id}`] ?? '',
        action: toWaitingAction(kind, header, file)
      }

const toReadState = (
  { kind, tab, sectionErrors }: TabStateInput,
  type: VersionFileType
): TabState | null => {
  const error = toSectionError(sectionErrors, tab.read)

  if (error !== null) {
    return {
      kind: 'error',
      title: `The ${fileWord(type)} couldn’t be read: ${error}.`,
      text: 'The rest of the page is unaffected — refresh to try again.'
    }
  }

  return toTooLarge(sectionErrors, tab.read)
    ? { kind: 'too-large', text: tooLargeTexts[kind](fileWord(type)) }
    : null
}

/** A tab's file not stored, failed, unreadable or too large; null when the tab shows its own content. */
export const toTabState = (input: TabStateInput): TabState | null => {
  const type = input.tab.file
  const file = type && input.header.files[type]

  if (!file) {
    return null
  }

  return file.stored
    ? toReadState(input, type)
    : toUnstoredState(input, type, file)
}

interface ShellInput {
  kind: VersionKind
  record: RecordType
  header: VersionHeader
  /** The tabs the version offers, in order. */
  tabs: VersionTab[]
  tab: VersionTab
  from: string
  sectionErrors: RecordSectionError[]
  notice?: DefinitionFetchFlash
  times: Times
  /** Alerts above the files' own, for this tab alone. */
  extraAlerts?: VersionAlert[]
}

const toSwitcher = ({
  record,
  header,
  tab,
  from
}: ShellInput): VersionPageShell['switcher'] => ({
  text: `Version ${header.version}`,
  label: `Version ${header.version}, switch version`,
  items: header.versions.map(({ version }) => ({
    text: `Version ${version}`,
    href: toTabHref(
      toVersionPath(record, { code: header.code, version }),
      tab.id,
      from
    ),
    checked: version === header.version
  }))
})

const toFetchForm = ({
  record,
  header,
  tab,
  from
}: ShellInput): FetchForm | null =>
  canFetch(header)
    ? {
        id: 'fetch-definitions',
        action: `${toVersionPath(record, header)}/fetch`,
        hidden: [
          { name: 'tab', value: tab.id },
          { name: 'back', value: from }
        ]
      }
    : null

const toReceived = ({ receivedAt }: VersionHeader, times: Times) => {
  const date = new Date(receivedAt)

  return Number.isNaN(date.getTime()) ? null : toTime(date, times)
}

const toAlerts = (
  input: ShellInput,
  fetched: VersionAlert[]
): VersionAlert[] => {
  const files = fetched.length
    ? fetched
    : toFileAlerts(input.kind, input.header)

  return [...(input.extraAlerts ?? []), ...files]
}

/** The page offers the fetch once: a waiting tab keeps its button only while no alert above offers it. */
const withoutRepeatedFetch = (
  state: TabState | null,
  alerts: VersionAlert[]
): TabState | null =>
  state?.kind === 'waiting' &&
  alerts.some(({ action }) => action?.kind === 'fetch')
    ? { ...state, action: null }
    : state

/** Everything around a version's tab: header, switcher, alerts, tabs, and what stands in for a tab with nothing to show. */
export const toVersionShell = (input: ShellInput): VersionPageShell => {
  const { kind, record, header, tabs, tab, from, notice, times } = input
  const href = toVersionPath(record, header)
  const outcome = toFetchOutcome(kind, notice, href, header)
  const alerts = toAlerts(input, outcome.alerts)

  return {
    pageTitle: `${tab.label} – ${header.code}@${header.version}`,
    backHref: toBackHref(record, from),
    navActive: ownLists[kind],
    title: header.code,
    status: statuses[header.status],
    switcher: toSwitcher(input),
    tabs: tabs.map(({ id, label }) => ({
      text: label,
      href: toTabHref(href, id, from),
      current: id === tab.id
    })),
    tabsLabel: kind === 'grant' ? 'Grant version' : 'Workflow version',
    tab: tab.id,
    alerts,
    fetchForm: toFetchForm(input),
    selfHref: toTabHref(href, tab.id, from),
    toasts: outcome.toast ? [outcome.toast] : [],
    tabState: withoutRepeatedFetch(
      toTabState({ kind, header, tab, sectionErrors: input.sectionErrors }),
      alerts
    ),
    received: toReceived(header, times)
  }
}
