import type {
  CaseOverview,
  CasePage
} from '../use-cases/get-case-page.use-case.ts'
import type {
  BucketEntry,
  Catalogue
} from '../use-cases/get-catalogue.use-case.ts'
import type { PositionNames } from '../use-cases/read-position-names.use-case.ts'
import type { RecordTab } from '../use-cases/record-reads.ts'
import {
  applicationType,
  toApplicationHref
} from './applications-page.view-model.ts'
import { toBucketPath } from './bucket-nav.ts'
import { caseType, toCaseHref } from './cases-page.view-model.ts'
import { toTabHref } from './record-page.view-model.ts'
import { toEventsTab, toSectionError } from './record-events-tab.ts'
import type { EventsCopy, TabNotice } from './record-events-tab.ts'
import { toRawTab } from './record-raw-tab.ts'
import { toReplacedAlert, toSeries } from './record-series.ts'
import type { SeriesModel } from './record-series.ts'
import { toRecordTime } from './record-times.ts'
import type { RecordTime } from './record-times.ts'
import {
  noTabBodies,
  toBackHref,
  toLinkBack,
  toRecordTabs,
  toVersionLink
} from './record-view.ts'
import type {
  CounterpartCard,
  PageOptions,
  RecordAlert,
  RecordView,
  TabBodies,
  VersionLink
} from './record-view.ts'
import {
  isEmptyPosition,
  noPositionFacts,
  toStatusName,
  toWhere
} from './record-where.ts'
import type { Where } from './record-where.ts'
import type { Times } from './times.ts'
import { toWorkflowHref } from './workflows-page.view-model.ts'

/** Closed at a time; still open; or CW didn't say. */
export type Closed =
  | { kind: 'at'; time: RecordTime | null }
  | { kind: 'open' }
  | { kind: 'unknown' }

export interface CaseOverviewModel {
  kind: 'shown'
  where: Where
  /** Null when CW sent nothing for the case. */
  application: CounterpartCard | null
  series: SeriesModel | null
  details: {
    /** Null when CW sent nothing, so the version isn't known either. */
    grantVersion: VersionLink | null
    created: RecordTime | null
    closed: Closed
  }
}

export type CasePageModel = RecordView<CaseOverviewModel>

export type NamedCasePage = CasePage & { names: PositionNames | null }

const unexpectedText =
  'Caseworking returned an unexpected answer. The rest of the page is unaffected.'

const nothing = 'CW returned no data for this tab.'

const eventsCopy: EventsCopy = {
  error: { title: 'Case events could not be read.', text: unexpectedText },
  nothing,
  empty: {
    title: 'No events found for this case',
    text: 'Events past their deletion date aren’t listed.'
  },
  source: 'CW',
  unreachable: {
    hop: 'CW-BE',
    message: {
      title: 'Caseworking’s events couldn’t be read.',
      text: 'CW-BE didn’t answer. Refresh to try again.'
    }
  }
}

/** Overview and Raw fail in the Events tab's words, with the tab's title the application's page uses. */
const tabError = { title: 'This tab couldn’t be read.', text: unexpectedText }

const rawCopy = { noun: 'case', error: tabError, nothing }

const noDataAlert: RecordAlert = {
  title: 'CW returned no data for this case.',
  text: 'The case exists, but its position and dates are empty. Values below show as not set.',
  action: null
}

const applicationsList = (
  catalogue: Catalogue | null
): BucketEntry | undefined =>
  (catalogue?.buckets ?? []).find(
    (entry) => toBucketPath(entry) === applicationType.path
  )

/** GAS's list of applications, filtered to the grant the case's workflow is named after. */
const toApplicationsHref = (
  catalogue: Catalogue | null,
  workflowCode: string
): string => {
  const grant = applicationsList(catalogue)?.facts.find(
    ({ name }) => name === 'code'
  )

  return grant
    ? `${applicationType.path}?${new URLSearchParams({ [grant.param]: workflowCode })}`
    : applicationType.path
}

const toNoApplicationCard = (
  catalogue: Catalogue | null,
  workflowCode: string
): CounterpartCard => ({
  kind: 'missing',
  title: 'Application',
  empty: {
    icon: 'file-question-mark',
    title: 'No application found',
    text: 'GAS has no application with this reference. The case may have been created from a test event.'
  },
  button: {
    text: 'Search applications',
    href: toApplicationsHref(catalogue, workflowCode)
  }
})

/** An application's ref and grant are its case's, by construction, so it can be opened even when GAS couldn't say it's there. */
const toApplicationCard = (
  { header }: CasePage,
  { catalogue, from }: PageOptions
): CounterpartCard => {
  if (header.counterpart?.exists === false) {
    return toNoApplicationCard(catalogue, header.workflowCode)
  }

  return {
    kind: 'link',
    title: 'Application',
    text: header.counterpart
      ? 'GAS holds the application for this case.'
      : 'GAS didn’t say whether it holds the application for this case.',
    button: {
      text: 'Open application',
      href: toLinkBack(
        toApplicationHref({
          code: header.workflowCode,
          clientRef: header.caseRef
        }),
        toCaseHref(header),
        from
      )
    }
  }
}

/** CW sent the case but nothing in it: no position and no dates. */
const isNoData = (
  { header }: CasePage,
  overview: CaseOverview | null | undefined
): boolean =>
  !overview || (isEmptyPosition(header.position) && overview.createdAt === null)

const toClosed = ({ closed, closedAt }: CaseOverview, times: Times): Closed => {
  if (closed === null) {
    return { kind: 'unknown' }
  }

  return closed
    ? { kind: 'at', time: toRecordTime(closedAt, times) }
    : { kind: 'open' }
}

/** Another member keeps the list this one was opened from, so Back still returns there. */
const seriesHrefOf =
  ({ header }: CasePage, from: string) =>
  (caseRef: string) =>
    toTabHref(
      toCaseHref({ workflowCode: header.workflowCode, caseRef }),
      'overview',
      from
    )

/** The version the case is on links to that workflow version. */
const toGrantVersion = (
  { header }: CasePage,
  overview: CaseOverview,
  { from }: PageOptions
): VersionLink =>
  toVersionLink(
    header.workflowCode,
    overview.currentConfigVersion,
    toWorkflowHref,
    toCaseHref(header),
    from
  )

const toNoDataOverview = (
  page: CasePage,
  options: PageOptions
): CaseOverviewModel => ({
  kind: 'shown',
  where: { kind: 'facts', facts: noPositionFacts },
  application: null,
  series: null,
  details: {
    grantVersion: page.overview
      ? toGrantVersion(page, page.overview, options)
      : null,
    created: null,
    closed: { kind: 'unknown' }
  }
})

const toOverview = (
  page: NamedCasePage,
  overview: CaseOverview,
  options: PageOptions
): CaseOverviewModel => ({
  kind: 'shown',
  where: toWhere(page.header.position, page.names),
  application: toApplicationCard(page, options),
  series: toSeries(
    overview.series,
    ({ caseRef, createdAt, closedAt }) => ({
      ref: caseRef,
      createdAt,
      closedAt
    }),
    {
      current: page.header.caseRef,
      source: 'CW',
      showClosed: true,
      hrefOf: seriesHrefOf(page, options.from),
      times: options.times
    }
  ),
  details: {
    grantVersion: toGrantVersion(page, overview, options),
    created: toRecordTime(overview.createdAt, options.times),
    closed: toClosed(overview, options.times)
  }
})

const hasOverviewError = ({ sectionErrors }: CasePage): boolean =>
  toSectionError(sectionErrors, 'overview') !== null

const toOverviewTab = (
  page: NamedCasePage,
  options: PageOptions,
  tabHref: string
): CaseOverviewModel | TabNotice => {
  if (hasOverviewError(page)) {
    return { kind: 'error', error: { ...tabError, retryHref: tabHref } }
  }

  return page.overview && !isNoData(page, page.overview)
    ? toOverview(page, page.overview, options)
    : toNoDataOverview(page, options)
}

const toNoDataAlert = (page: CasePage): RecordAlert | null =>
  !hasOverviewError(page) && isNoData(page, page.overview) ? noDataAlert : null

const toCaseReplacedAlert = (page: CasePage, from: string) =>
  toReplacedAlert(page.overview?.series ?? null, {
    current: page.header.caseRef,
    noun: 'case',
    source: 'CW',
    hrefOf: seriesHrefOf(page, from)
  })

/** A replaced case says so first: where its newest is matters more than what this one holds. */
const toCaseAlert = (page: CasePage, from: string): RecordAlert | null =>
  toCaseReplacedAlert(page, from) ?? toNoDataAlert(page)

const tabBodies: Record<
  RecordTab,
  TabBodies<NamedCasePage, CaseOverviewModel>
> = {
  overview: (page, options, tabHref) => ({
    alert: toCaseAlert(page, options.from),
    overview: toOverviewTab(page, options, tabHref)
  }),
  events: (page, { times }, tabHref) => ({
    events: toEventsTab(page, eventsCopy, tabHref, times)
  }),
  raw: (page, _options, tabHref) => ({
    raw: toRawTab(page, rawCopy, tabHref)
  })
}

export const toCasePage = (
  page: NamedCasePage,
  tab: RecordTab,
  options: PageOptions
): CasePageModel => {
  const { header } = page
  const href = toCaseHref(header)

  return {
    record: caseType,
    navActive: null,
    ref: header.caseRef,
    backHref: toBackHref(caseType, options.from),
    status: toStatusName(header.position, page.names),
    tab,
    tabs: toRecordTabs(caseType, href, tab, options.from),
    ...noTabBodies,
    ...tabBodies[tab](page, options, toTabHref(href, tab, options.from))
  }
}
