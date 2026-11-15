import type { VersionSummary } from '../use-cases/definition-fetches.ts'
import type { BadgeRole } from '../use-cases/get-event.use-case.ts'
import type {
  BucketFactValue,
  Catalogue
} from '../use-cases/get-catalogue.use-case.ts'
import { toClock, toPreciseInstant, toValidDate } from './event-formats.ts'
import type { Zone } from './event-formats.ts'
import { toTabHref } from './record-page.view-model.ts'
import { toVersionPath } from './record-type.ts'
import type { RecordType } from './record-type.ts'
import {
  fileOrder,
  toBannerLines,
  toListValues,
  toFetchLabel
} from './version-banner.ts'
import type {
  BannerTone,
  VersionFiles,
  VersionFileType
} from './version-banner.ts'
import type { Words } from './words.ts'

/** A grant's or a workflow's version, as GAS heads either page. */
interface VersionPageHeader extends VersionFiles {
  receivedAt: string
  /** Newest first. */
  versions: VersionSummary[]
}

interface StatusBadge {
  status: string
  role: BadgeRole
  title?: string
}

/** The shared filter menu's link items, with no `value`: a version is a page, never a filter. */
interface SwitcherItem {
  label: string
  status: StatusBadge
  /** A draft's own badge, beside its Definition badge. */
  secondary: StatusBadge | null
  /** Said of a version whose files are all stored, which its badge cannot say. */
  note: { text: string; title: string } | null
  aside: string
  /** The exact instant, which the short `aside` drops. */
  asideTitle: string | null
  href: string
  active: boolean
}

export interface VersionHeader {
  status: StatusBadge
  switcher: {
    name: string
    label: string
    small: true
    testId: string
    panelId: string
    items: SwitcherItem[]
  }
  /** What the page knows of its files that the list cannot say, and the form that fetches any not stored. */
  banner: {
    tone: BannerTone
    lines: Words[]
    fetch: { action: string; back: string; tab: string; label: string } | null
  } | null
}

const statuses: Record<VersionSummary['status'], StatusBadge> = {
  active: { status: 'Active', role: 'success' },
  draft: { status: 'Draft', role: 'neutral' }
}

const mainFiles: VersionFileType[] = ['grant', 'workflow']

/** The grant or workflow file is stored, so no other version need be offered in its place. */
const isMainStored = ({ files }: VersionPageHeader): boolean =>
  mainFiles.some((type) => files[type]?.stored === true)

/** The newest other version with every file stored, from the header's newest-first list. */
const findNewestStored = (
  header: VersionPageHeader
): VersionSummary | undefined =>
  header.versions.find(
    ({ version, stored }) => stored && version !== header.version
  )

/** The newest other version with every file stored, linked on the same tab, while this one's main file is not stored. */
const toNewestStored = (
  record: RecordType,
  header: VersionPageHeader,
  tab: string,
  back: string
): Words => {
  const newest = isMainStored(header) ? undefined : findNewestStored(header)

  return newest === undefined
    ? []
    : [
        'Newest stored version: ',
        {
          link: `${newest.version} ›`,
          href: toTabHref(
            toVersionPath(record, {
              code: header.code,
              version: newest.version
            }),
            tab,
            back
          )
        }
      ]
}

const toBanner = (
  record: RecordType,
  header: VersionPageHeader,
  tab: string,
  back: string
): VersionHeader['banner'] => {
  const said = toBannerLines(record, header)

  if (said === null) {
    return null
  }

  const newestStored = toNewestStored(record, header, tab, back)
  const unstored = fileOrder.some(
    (type) => header.files[type]?.stored === false
  )

  return {
    tone: said.tone,
    lines: newestStored.length ? [...said.lines, newestStored] : said.lines,
    fetch: unstored
      ? {
          action: `${toVersionPath(record, header)}/fetch`,
          back,
          tab,
          label: toFetchLabel(record)
        }
      : null
  }
}

const draftClause = (record: RecordType): string =>
  `Draft: ${record.source} won't pick it for new work until it is published as active.`

/** The badge as the list draws it, titled by what the value means, and on a draft by the draft clause too. */
const toListBadge = (
  { label, tone = 'neutral', hint = label }: BucketFactValue,
  draftOf: RecordType | null
): StatusBadge => ({
  status: label,
  role: tone,
  title: draftOf ? `${hint} ${draftClause(draftOf)}` : hint
})

const toDefinitionBadge = (
  record: RecordType,
  values: BucketFactValue[],
  { fetchStatus, status }: VersionSummary
): StatusBadge | null => {
  const value = values.find((option) => option.value === fetchStatus)

  return value ? toListBadge(value, status === 'draft' ? record : null) : null
}

const notLoadedStatuses = new Set<VersionSummary['fetchStatus']>([
  'pending',
  'transient_error'
])

const toStoredNote = (
  record: RecordType,
  { stored, fetchStatus }: VersionSummary
): SwitcherItem['note'] =>
  stored && notLoadedStatuses.has(fetchStatus)
    ? {
        text: `· stored, not loaded by ${record.source} yet`,
        title: `Every file is stored. ${record.source} hasn't loaded it itself yet, so the list still shows its fetch status.`
      }
    : null

/** The version's status as the list words it, titled by what it means; GPA's own word without the catalogue. */
const toStatusBadge = (
  values: BucketFactValue[],
  status: VersionSummary['status']
): StatusBadge => {
  const value = values.find((option) => option.value === status)

  return value ? toListBadge(value, null) : statuses[status]
}

interface ListValues {
  definition: BucketFactValue[]
  status: BucketFactValue[]
}

/** A version's Definition badge, as the list shows it, with its status beside it only while it is a draft. */
const toBadges = (
  record: RecordType,
  values: ListValues,
  summary: VersionSummary
): Pick<SwitcherItem, 'status' | 'secondary' | 'note'> => {
  const definition = toDefinitionBadge(record, values.definition, summary)
  const status = toStatusBadge(values.status, summary.status)

  if (definition === null) {
    return { status, secondary: null, note: null }
  }

  return {
    status: definition,
    secondary: summary.status === 'active' ? null : status,
    note: toStoredNote(record, summary)
  }
}

/** Anything but a date is shown as stored. */
const toReceived = (
  receivedAt: string,
  now: Date,
  zone: Zone
): Pick<SwitcherItem, 'aside' | 'asideTitle'> => {
  const date = toValidDate(receivedAt)

  return date
    ? {
        aside: toClock(date, now, zone),
        asideTitle: toPreciseInstant(date, zone)
      }
    : { aside: receivedAt, asideTitle: null }
}

export const toVersionHeader = (
  record: RecordType,
  header: VersionPageHeader,
  tab: string,
  from: string,
  zone: Zone,
  catalogue: Catalogue | null = null,
  now: Date = new Date()
): VersionHeader => {
  const values = {
    definition: toListValues(record, catalogue, 'definition'),
    status: toListValues(record, catalogue, 'status')
  }

  return {
    status: toStatusBadge(values.status, header.status),
    switcher: {
      name: 'Version',
      label: `Versions of ${header.code}`,
      small: true,
      testId: `${record.itemId}-switcher`,
      panelId: `${record.itemId}-switcher-panel`,
      items: header.versions.map((summary) => ({
        label: summary.version,
        ...toBadges(record, values, summary),
        ...toReceived(summary.receivedAt, now, zone),
        href: toTabHref(
          toVersionPath(record, {
            code: header.code,
            version: summary.version
          }),
          tab,
          from
        ),
        active: summary.version === header.version
      }))
    },
    banner: toBanner(record, header, tab, from)
  }
}
