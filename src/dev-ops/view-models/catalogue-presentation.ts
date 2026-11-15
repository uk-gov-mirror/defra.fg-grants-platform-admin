import type {
  BucketColumn,
  BucketEntry,
  BucketFact
} from '../use-cases/get-catalogue.use-case.ts'
import type { BadgeRole } from '../use-cases/get-event.use-case.ts'

/** The tones a status dot is drawn in. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

interface TitlePresentation {
  label?: string
  /** A column the title is joined with, as `code@version`. */
  versionColumn?: string
  width?: string
}

interface ColumnPresentation {
  label?: string
  width?: string
  drop?: boolean
  /** The value's hint, from the catalogue, in a tooltip on the cell. */
  tooltip?: boolean
}

/**
 * How GPA draws a catalogue list where its design says something the
 * catalogue doesn't yet. Each entry names the service change that retires it.
 */
export interface ListPresentation {
  title?: TitlePresentation
  /** The row's subtitle as a column of its own. */
  subtitle?: { label: string; mono?: boolean; width?: string }
  columns?: Record<string, ColumnPresentation>
  /** Fact names in the order their chips go; any other follows, as the catalogue has it. */
  chipOrder?: string[]
  /** By fact name: the chip, the column and the applied tag say the same. */
  facts?: Record<string, { label: string }>
  /** By fact name, then value. */
  tones?: Record<string, Record<string, Tone>>
  time?: { label?: string; width?: string }
  /** What a list with filters on and nothing found says. */
  noMatchText?: string
  /** What a list with nothing in it at all says, given the service that keeps it. */
  emptyText?: (service: string) => string
  /** The name of the tabs of the lists that share a page. */
  tabsLabel?: string
  /** By fact name: values the menu lists last, after the catalogue's order. */
  lastValues?: Record<string, string[]>
}

/** Queued reads as info and Failed as danger, which the catalogue gives as neutral and warning. */
const eventStatusTones: Record<string, Tone> = {
  PUBLISHED: 'info',
  FAILED: 'danger'
}

/** Widths that don't follow the widest cell, so the columns stay still as more rows load. */
const dateWidth = 'var(--size-column-date)'

const eventsList = (box: 'outbox' | 'inbox'): ListPresentation => ({
  title: { width: 'minmax(220px, 1fr)' },
  subtitle: { label: 'Event ID', mono: true, width: '336px' },
  columns: { status: { width: '128px' } },
  tones: { status: eventStatusTones },
  time: { label: 'Created', width: dateWidth },
  noMatchText: 'Nothing created in this time range has this status and event.',
  emptyText: (service) =>
    `Events ${service} ${box === 'outbox' ? 'sends' : 'receives'} appear here.`,
  tabsLabel: 'Queue',
  lastValues: { eventType: ['Audit'] }
})

const recordList = (
  time?: string
): Pick<ListPresentation, 'title' | 'time'> => ({
  title: { width: 'minmax(180px, 1fr)' },
  time: { label: time, width: dateWidth }
})

const versionWidths = {
  definition: { label: 'Stored', width: '160px' },
  status: { width: '128px' }
}

const configList = (title: string, column: string): ListPresentation => ({
  title: {
    label: title,
    versionColumn: 'version',
    width: 'minmax(220px, 1fr)'
  },
  chipOrder: ['grantCode', column, 'status'],
  columns: versionWidths,
  time: { width: dateWidth },
  facts: { [column]: { label: 'Stored' } },
  noMatchText:
    'Nothing received in this time range has this status and definition state.',
  emptyText: (service) =>
    `Versions the config broker publishes to ${service} appear here.`
})

/**
 * Keyed by catalogue list id. The service change that retires each entry:
 * - events: GAS and CW give PUBLISHED the tone info and FAILED danger, label
 *   the inbox's time "Created" and declare the subtitle as the Event ID column.
 * - gas.applications, cw.cases: the code column becomes "Grant", the
 *   position column goes, and GAS labels its time "Received".
 * - gas.grants, cw.workflows: the title and version become one "Grant"
 *   / "Workflow" column, "Definition" is labelled "Stored", and the
 *   Stored chip comes before Status.
 */
export const cataloguePresentation: Record<string, ListPresentation> = {
  'gas.outbox': eventsList('outbox'),
  'gas.inbox': eventsList('inbox'),
  'cw.outbox': eventsList('outbox'),
  'cw.inbox': eventsList('inbox'),
  'gas.applications': {
    ...recordList('Received'),
    columns: {
      code: { label: 'Grant', width: 'minmax(220px, 1fr)' },
      position: { drop: true }
    },
    emptyText: (service) => `Applications ${service} receives appear here.`
  },
  'cw.cases': {
    ...recordList(),
    columns: {
      workflowCode: { label: 'Grant', width: 'minmax(220px, 1fr)' },
      position: { drop: true }
    },
    emptyText: (service) => `Cases ${service} creates appear here.`
  },
  'gas.grants': {
    ...configList('Grant', 'worstFetchStatus'),
    columns: {
      ...versionWidths,
      definition: { ...versionWidths.definition, tooltip: true }
    }
  },
  'cw.workflows': configList('Workflow', 'fetchStatus')
}

const none: ListPresentation = {}

export const presentationOf = ({ id }: Pick<BucketEntry, 'id'>) =>
  cataloguePresentation[id] ?? none

/** The catalogue's tone in a status dot's terms: the one mapping every list uses. */
const catalogueTones: Record<BadgeRole, Tone> = {
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'danger'
}

const toCatalogueTone = (declared: BadgeRole | undefined): Tone =>
  catalogueTones[declared ?? 'neutral'] ?? 'neutral'

const presentedTone = (
  bucket: Pick<BucketEntry, 'id'>,
  fact: string,
  value: string
): Tone | undefined => presentationOf(bucket).tones?.[fact]?.[value]

export const toTone = (
  bucket: Pick<BucketEntry, 'id'>,
  fact: string,
  value: string,
  declared: BadgeRole | undefined
): Tone => presentedTone(bucket, fact, value) ?? toCatalogueTone(declared)

export const toFactLabel = (
  bucket: Pick<BucketEntry, 'id'>,
  { name, label }: Pick<BucketFact, 'name' | 'label'>
): string => presentationOf(bucket).facts?.[name]?.label ?? label

const chipRank = (order: string[], name: string): number => {
  const at = order.indexOf(name)

  return at < 0 ? order.length : at
}

/** The facts in the order the list's chips go. */
export const toChipOrder = <F extends Pick<BucketFact, 'name'>>(
  bucket: Pick<BucketEntry, 'id'>,
  facts: F[]
): F[] => {
  const order = presentationOf(bucket).chipOrder ?? []

  return [...facts].sort(
    (a, b) => chipRank(order, a.name) - chipRank(order, b.name)
  )
}

export const toTimeLabel = (bucket: Pick<BucketEntry, 'id' | 'time'>) =>
  presentationOf(bucket).time?.label ?? bucket.time.label

/** A list column as drawn: the catalogue's own, or the title, subtitle and time GPA adds around them. */
export interface ListColumn {
  key: string
  label: string
  kind: 'title' | 'subtitle' | 'cell' | 'time'
  format: string
  fact: string | null
  mono: boolean
  width: string
  align: 'start' | 'right'
  tooltip: boolean
}

const titleColumn = (bucket: BucketEntry): ListColumn => {
  const title = {
    label: bucket.title.label,
    width: 'auto',
    ...presentationOf(bucket).title
  }

  return {
    key: 'title',
    label: title.label,
    kind: 'title',
    format: bucket.title.format,
    fact: null,
    mono: bucket.title.format === 'mono',
    width: title.width,
    align: 'start',
    tooltip: false
  }
}

const subtitleColumns = (bucket: BucketEntry): ListColumn[] => {
  const declared = presentationOf(bucket).subtitle

  if (!declared) {
    return []
  }

  const subtitle = { mono: false, width: 'auto', ...declared }

  return [
    {
      key: 'subtitle',
      label: subtitle.label,
      kind: 'subtitle',
      format: subtitle.mono ? 'mono' : 'text',
      fact: null,
      mono: subtitle.mono,
      width: subtitle.width,
      align: 'start',
      tooltip: false
    }
  ]
}

const columnOf = (bucket: BucketEntry, key: string): ColumnPresentation =>
  presentationOf(bucket).columns?.[key] ?? {}

const isShown = (bucket: BucketEntry, { key }: BucketColumn): boolean =>
  !columnOf(bucket, key).drop && toVersionColumn(bucket) !== key

const toCellColumn =
  (bucket: BucketEntry) =>
  (column: BucketColumn): ListColumn => {
    const shown = {
      label: column.label,
      width: 'auto',
      tooltip: false,
      ...columnOf(bucket, column.key)
    }

    return {
      key: column.key,
      label: shown.label,
      kind: 'cell',
      format: column.format,
      fact: column.fact ?? null,
      mono: column.format === 'mono',
      width: shown.width,
      align: column.format === 'time' ? 'right' : 'start',
      tooltip: shown.tooltip
    }
  }

const timeColumn = (bucket: BucketEntry): ListColumn => ({
  key: 'time',
  label: toTimeLabel(bucket),
  kind: 'time',
  format: 'time',
  fact: null,
  mono: false,
  width: presentationOf(bucket).time?.width ?? 'max-content',
  align: 'right',
  tooltip: false
})

/** Title first, then the subtitle, the catalogue's columns and the time. */
export const toListColumns = (bucket: BucketEntry): ListColumn[] => [
  titleColumn(bucket),
  ...subtitleColumns(bucket),
  ...bucket.columns
    .filter((column) => isShown(bucket, column))
    .map(toCellColumn(bucket)),
  timeColumn(bucket)
]

/** The column a list's title is joined with, as `code@version`; null for a title that stands alone. */
export const toVersionColumn = (bucket: BucketEntry): string | null =>
  presentationOf(bucket).title?.versionColumn ?? null
