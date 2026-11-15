import { statusCodes } from '../../common/status-codes.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'
import type {
  ConfigFailed,
  DeadLetters,
  FailedVersion,
  ListLink,
  Overview,
  OverviewCount,
  OverviewPart,
  OverviewResult,
  OverviewSourceError,
  PerService,
  TokensExpiring,
  TopError,
  TopErrors
} from '../use-cases/get-overview.use-case.ts'
import type { ClientService } from '../use-cases/access-tokens.use-case.ts'
import { tokenStates } from './access-token-rows.ts'
import {
  clientServices,
  serviceWords,
  toClientsPath
} from './access-token-services.ts'
import { devOpsPath, overviewNavId } from './bucket-nav.ts'
import { toGrantHref } from './grants-page.view-model.ts'
import type { Tone } from './catalogue-presentation.ts'
import { toDayTime, toTime, toTimes } from './times.ts'
import type { Times, TimeText } from './times.ts'
import { toWorkflowHref } from './workflows-page.view-model.ts'

export const overviewNavActive = overviewNavId

/** The Overview is the admin's own root: the page sign-in lands on. */
export const overviewPath = devOpsPath

const topErrorsShown = 5

const counted = new Intl.NumberFormat('en-GB')

/** A count the service stopped at its cap is written with a plus: `10,000+`. */
export const toCount = ({ count, capped }: OverviewCount): string =>
  `${counted.format(count)}${capped ? '+' : ''}`

const shortName = (service: ClientService): string =>
  serviceWords[service].short

/** Who didn't answer: GAS, or CW behind it. */
const hopName = ({ hop }: OverviewSourceError): string =>
  hop === 'CW-BE' ? serviceWords.cw.short : serviceWords.gas.short

export interface SectionAlert {
  tone: 'danger' | 'warning'
  title: string
  text: string
}

const unaffected = 'The rest of the page is unaffected.'

const reasonTexts: Record<
  Exclude<OverviewSourceError['reason'], 'NOT_OFFERED'>,
  string
> = {
  UNREACHABLE: 'couldn’t be reached.',
  TIMED_OUT: 'didn’t answer in time.',
  ERRORED: 'answered with an error.'
}

/** What each part is called where it couldn't be loaded. */
type PartName = 'deadLetters' | 'topErrors' | 'configFailed' | 'tokensExpiring'

const partNouns: Record<PartName, Record<ClientService, string>> = {
  deadLetters: { gas: 'dead letters', cw: 'dead letters' },
  topErrors: { gas: 'errors', cw: 'errors' },
  configFailed: { gas: 'grant versions', cw: 'workflow versions' },
  tokensExpiring: { gas: 'access tokens', cw: 'access tokens' }
}

/** An older service without this read: trying again won't help, so it is a warning, said as the tokens page says it. */
const toNotOffered = (
  part: PartName,
  name: string,
  noun: string
): SectionAlert =>
  part === 'tokensExpiring'
    ? {
        tone: 'warning',
        title: `This ${name} doesn’t offer access tokens.`,
        text: `It’s an older version without the access tokens API. Tokens can be managed here once ${name} is upgraded.`
      }
    : {
        tone: 'warning',
        title: `This ${name} doesn’t offer its ${noun} here yet.`,
        text: `It’s an older version. They show here once ${name} is upgraded. ${unaffected}`
      }

/** Said where the part would be, naming the service that didn't answer; the rest of the page stays. */
export const toPartAlert = (
  part: PartName,
  service: ClientService,
  error: OverviewSourceError
): SectionAlert => {
  const noun = partNouns[part][service]
  const who = hopName(error)

  return error.reason === 'NOT_OFFERED'
    ? toNotOffered(part, who, noun)
    : {
        tone: 'danger',
        title: `${shortName(service)}’s ${noun} couldn’t be loaded.`,
        text: `${who} ${reasonTexts[error.reason]} ${unaffected}`
      }
}

interface Read<T> {
  service: ClientService
  data: T
}

const readParts = <T>(parts: PerService<T>): Read<T>[] =>
  clientServices.flatMap((service) => {
    const { data } = parts[service] as OverviewPart<T>

    return data === null ? [] : [{ service, data }]
  })

const partAlerts = <T>(part: PartName, parts: PerService<T>): SectionAlert[] =>
  clientServices.flatMap((service) => {
    const { sourceError } = parts[service] as OverviewPart<T>

    return sourceError === null ? [] : [toPartAlert(part, service, sourceError)]
  })

/** Both parts failed: nothing to draw a table of. */
const noneRead = <T>(parts: PerService<T>): boolean =>
  readParts(parts).length === 0

/** A list as GAS links it: Top errors with no time range (they are the current dead letters), a box's dead letters over the window. */
const toListHref = ({ path, query }: ListLink): string =>
  `${devOpsPath}/${path}?${new URLSearchParams(query).toString()}`

const toOptionalTime = (value: string | null, times: Times): TimeText | null =>
  value === null ? null : toTime(new Date(value), times)

export interface Figure {
  label: string
  /** Null when its part couldn't be read: a faint dash, never 0. */
  value: string | null
  trend: number[] | null
  trendLabel: string | null
  hint: string | null
  testId: string
}

const trendLabel = 'Dead letters every two hours, last 24 hours'

/** No line when there is nothing to draw: unread, or none counted. */
const toTrend = (data: DeadLetters | null) =>
  data?.count
    ? { trend: data.bars.map(({ count }) => count), trendLabel }
    : { trend: null, trendLabel: null }

const toDeadLetterFigure = (
  service: ClientService,
  { data }: OverviewPart<DeadLetters>
): Figure => ({
  label: `${shortName(service)} dead letters, last 24 hours`,
  value: data === null ? null : toCount(data),
  ...toTrend(data),
  hint: null,
  testId: `overview-figure-dead-letters-${service}`
})

const totalOf = <T>(
  parts: PerService<T>,
  countOf: (data: T) => number
): string | null =>
  readParts(parts).length === clientServices.length
    ? counted.format(
        readParts(parts).reduce((sum, { data }) => sum + countOf(data), 0)
      )
    : null

const toFigures = (overview: Overview): Figure[] => [
  toDeadLetterFigure('gas', overview.deadLetters.gas),
  toDeadLetterFigure('cw', overview.deadLetters.cw),
  {
    label: 'Config versions that failed',
    value: totalOf(overview.configFailed, ({ versions }) => versions.length),
    trend: null,
    trendLabel: null,
    hint: null,
    testId: 'overview-figure-config'
  },
  {
    label: 'Access tokens expiring',
    value: totalOf(overview.tokensExpiring, ({ tokens }) => tokens.length),
    trend: null,
    trendLabel: null,
    hint: 'within 30 days, or expired',
    testId: 'overview-figure-tokens'
  }
]

export interface TopErrorRow {
  /** Null for the dead letters that recorded no error. */
  error: string | null
  service: string
  event: string | null
  count: string
  lastSeen: TimeText | null
  href: string
}

export interface ListAction {
  text: string
  href: string
  testId: string
}

export interface TopErrorsSection {
  alerts: SectionAlert[]
  rows: TopErrorRow[] | null
  /** A summary met more kinds of error than it counts, so the ranking may miss some. */
  partial: string | null
}

/** The key both services store a dead letter that recorded no error under: a group like any other, said in plain words. */
export const noErrorKey = 'No error recorded'

const byCount = (a: Read<TopError>, b: Read<TopError>): number =>
  b.data.count - a.data.count

/** The error a row names, null for the dead letters that recorded none; GAS keys a thrown Error as `Error: <message>`, and the row shows the message. */
const toErrorText = (errorKey: string | null): string | null =>
  errorKey === null || errorKey === noErrorKey
    ? null
    : errorKey.replace(/^Error: /, '')

const toTopErrorRow =
  (times: Times) =>
  ({ service, data }: Read<TopError>): TopErrorRow => ({
    error: toErrorText(data.errorKey),
    service: shortName(service),
    event: data.event?.label ?? null,
    count: toCount(data),
    lastSeen: toOptionalTime(data.lastAt, times),
    href: toListHref(data.list)
  })

const incompleteOf = (read: Read<TopErrors>[]): string | null => {
  const services = read
    .filter(({ data }) => !data.complete)
    .map(({ service }) => shortName(service))

  return services.length
    ? `${services.join(' and ')} met more kinds of error than ${services.length > 1 ? 'they count' : 'it counts'}, so this ranking may miss some.`
    : null
}

const deadLetterWord = ({ count, capped }: OverviewCount): string =>
  count === 1 && !capped ? 'dead letter' : 'dead letters'

/** Each box that has dead letters in the window, opening its list on exactly those: Top errors are the current ones, so these sit with the 24-hour figures. */
const toDeadLetterLinks = (overview: Overview): ListAction[] =>
  readParts(overview.deadLetters).flatMap(({ service, data }) =>
    data.lists
      .filter(({ count, capped }) => count > 0 || capped)
      .map((box) => ({
        text: `${shortName(service)} ${box.box}: ${toCount(box)} ${deadLetterWord(box)}`,
        href: toListHref(box.list),
        testId: `overview-dead-letters-${service}-${box.box}`
      }))
  )

const toTopErrors = (overview: Overview, times: Times): TopErrorsSection => {
  const read = readParts(overview.topErrors)
  const entries = read
    .flatMap(({ service, data }) =>
      data.entries.map((entry) => ({ service, data: entry }))
    )
    .toSorted(byCount)
    .slice(0, topErrorsShown)

  return {
    alerts: partAlerts('topErrors', overview.topErrors),
    rows: noneRead(overview.topErrors)
      ? null
      : entries.map(toTopErrorRow(times)),
    partial: incompleteOf(read)
  }
}

export interface DeadLetterChart {
  title: string
  summary: string
  x: string[]
  xLabel: string
  series: { name: string; data: number[] }[]
  /** Said under the chart: what the bars count by, and a cap when one was met. */
  notes: string[]
}

/** `14:37`: the clock a bar ends at, on the Times setting. */
const toClock = (instant: string, times: Times): string =>
  toTime(new Date(instant), times).text.slice(-5)

const peakOf = ({ service, data }: Read<DeadLetters>, times: Times): string => {
  const peak = data.bars.reduce(
    (most, bar) => (bar.count > most.count ? bar : most),
    data.bars[0]!
  )

  return peak.count
    ? `${shortName(service)} ${toCount(peak)}, to ${toClock(peak.to, times)}`
    : `${shortName(service)} none`
}

const createdNote =
  'Counted by when each event was created: when it was dead-lettered isn’t stored.'

const toCapNote = (overview: Overview, read: Read<DeadLetters>[]) =>
  read.some(({ data }) => data.bars.some(({ capped }) => capped))
    ? [
        `A two-hour count over ${counted.format(overview.countCap)} is drawn at ${counted.format(overview.countCap)}.`
      ]
    : []

/** Drawn when both services were read and at least one dead letter was counted; all clear draws none. */
const toChart = (overview: Overview, times: Times): DeadLetterChart | null => {
  const read = readParts(overview.deadLetters)

  if (
    read.length < clientServices.length ||
    read.every(({ data }) => data.count === 0)
  ) {
    return null
  }

  return {
    title: 'Dead letters, last 24 hours',
    summary: `The most in two hours: ${read.map((part) => peakOf(part, times)).join('; ')}.`,
    x: read[0]!.data.bars.map(({ to }) => toClock(to, times)),
    xLabel: 'Two hours to',
    series: read.map(({ service, data }) => ({
      name: shortName(service),
      data: data.bars.map(({ count }) => count)
    })),
    notes: [createdNote, ...toCapNote(overview, read)]
  }
}

export interface ConfigRow {
  version: string
  service: string
  type: string
  definition: { text: string; tone: Tone }
  received: TimeText | null
  href: string
}

export interface TableSection<R> {
  alerts: SectionAlert[]
  rows: R[] | null
  /** More than the service sent. */
  more: string | null
}

const definitions: Record<
  FailedVersion['definition'],
  { text: string; tone: Tone }
> = {
  permanent_error: { text: 'Failed', tone: 'danger' },
  transient_error: { text: 'Fetch error', tone: 'warning' }
}

const versionTypes: Record<
  ClientService,
  { type: string; toHref: (ref: FailedVersion) => string }
> = {
  gas: { type: 'Grant', toHref: toGrantHref },
  cw: { type: 'Workflow', toHref: toWorkflowHref }
}

const toConfigRow =
  (service: ClientService, times: Times) =>
  (version: FailedVersion): ConfigRow => ({
    version: `${version.code}@${version.version}`,
    service: shortName(service),
    type: versionTypes[service].type,
    definition: definitions[version.definition],
    received: toOptionalTime(version.receivedAt, times),
    href: versionTypes[service].toHref(version)
  })

const toConfigFailed = (
  overview: Overview,
  times: Times
): TableSection<ConfigRow> => {
  const read = readParts<ConfigFailed>(overview.configFailed)
  const cut = read.filter(({ data }) => data.more)

  return {
    alerts: partAlerts('configFailed', overview.configFailed),
    rows: noneRead(overview.configFailed)
      ? null
      : read.flatMap(({ service, data }) =>
          data.versions.map(toConfigRow(service, times))
        ),
    more: cut.length
      ? `${cut.map(({ service }) => shortName(service)).join(' and ')} sent the first ${cut.map(({ data }) => data.versions.length).join(' and ')}; open its list for the rest.`
      : null
  }
}

export interface TokenRow {
  client: string | null
  service: string
  status: { text: string; tone: string }
  expires: TimeText | null
  href: string
}

/** An expiry is a UK day by rule, written as one whatever Times says, as the tokens page writes it. */
const ukTimes = toTimes('uk')

/** GAS sends only active tokens within its window and expired ones, so the status alone says which: no second 30-day rule here. */
const toTokenStatus = ({ status }: TokensExpiring['tokens'][number]) =>
  status === 'EXPIRED' ? tokenStates.expired : tokenStates.expiring

const toTokenRow =
  (service: ClientService) =>
  (token: TokensExpiring['tokens'][number]): TokenRow => ({
    client: token.clientId,
    service: shortName(service),
    status: toTokenStatus(token),
    expires:
      token.expiresAt === null
        ? null
        : toDayTime(new Date(token.expiresAt), ukTimes),
    href: `${toClientsPath(service)}?token=${encodeURIComponent(token.tokenId)}`
  })

const toTokensExpiring = (overview: Overview): TableSection<TokenRow> => ({
  alerts: partAlerts('tokensExpiring', overview.tokensExpiring),
  rows: noneRead(overview.tokensExpiring)
    ? null
    : readParts(overview.tokensExpiring).flatMap(({ service, data }) =>
        data.tokens.map(toTokenRow(service))
      ),
  more: null
})

export interface PageAlert extends SectionAlert {
  retryHref: string | null
}

const failureTexts: Record<GasFailure['kind'], string> = {
  'not-connected':
    'GAS couldn’t be reached. Nothing has changed — try again in a moment.',
  'cw-not-reached':
    'CW couldn’t be reached. Nothing has changed — try again in a moment.',
  refused: 'GAS refused the request. Nothing has changed.',
  errored:
    'GAS answered with an error. Nothing has changed — try again in a moment; if it keeps failing, check GAS’s logs.',
  'timed-out':
    'GAS didn’t answer in time. Nothing has changed — try again in a moment.',
  'no-answer':
    'GAS didn’t answer in time. Nothing has changed — try again in a moment.'
}

const notOfferedAlert: PageAlert = {
  tone: 'warning',
  title: 'This GAS doesn’t offer the overview.',
  text: 'It’s an older version without it. The overview shows here once GAS is upgraded; every list is still in the sidebar.',
  retryHref: null
}

const toPageAlert = (
  result: Exclude<OverviewResult, { outcome: 'read' }>
): PageAlert =>
  result.outcome === 'not-offered'
    ? notOfferedAlert
    : {
        tone: 'danger',
        title: 'The overview couldn’t be loaded.',
        text: failureTexts[result.failure.kind],
        retryHref: overviewPath
      }

export interface OverviewSections {
  figures: Figure[]
  topErrors: TopErrorsSection
  chart: DeadLetterChart | null
  deadLetterAlerts: SectionAlert[]
  deadLetterLinks: ListAction[]
  configFailed: TableSection<ConfigRow>
  tokensExpiring: TableSection<TokenRow>
}

export interface OverviewPage {
  pageTitle: string
  meta: string[]
  navActive: string
  alert: PageAlert | null
  sections: OverviewSections | null
}

const toSections = (overview: Overview, times: Times): OverviewSections => ({
  figures: toFigures(overview),
  topErrors: toTopErrors(overview, times),
  chart: toChart(overview, times),
  deadLetterAlerts: partAlerts('deadLetters', overview.deadLetters),
  deadLetterLinks: toDeadLetterLinks(overview),
  configFailed: toConfigFailed(overview, times),
  tokensExpiring: toTokensExpiring(overview)
})

export const toOverviewPage = (
  result: OverviewResult,
  { times }: { times: Times }
): OverviewPage => ({
  pageTitle: 'Overview',
  meta: ['Grant Application Service and Caseworking'],
  navActive: overviewNavActive,
  ...(result.outcome === 'read'
    ? { alert: null, sections: toSections(result.overview, times) }
    : { alert: toPageAlert(result), sections: null })
})

/** 503 for an overview that couldn't be read, as a list that couldn't; a GAS that offers none is no failure. */
export const toOverviewStatusCode = ({ outcome }: OverviewResult): number =>
  outcome === 'failed' ? statusCodes.serviceUnavailable : statusCodes.ok
