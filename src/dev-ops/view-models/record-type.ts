export interface RecordTabEntry {
  id: string
  label: string
}

/** What tells one record's page from another's; they are otherwise the same. */
export interface RecordType {
  /** The list a Back link names. */
  listId: string
  itemId: string
  title: string
  /** Where its pages live. */
  path: string
  /** The service a failed read is blamed on. */
  source: string
  linkLabel: string
  /** In the order they are offered. */
  tabs: readonly RecordTabEntry[]
  /** The template that draws it. */
  view: string
  /** The URL param named after the title. */
  titleParam: string
}

export const recordTabEntries: readonly RecordTabEntry[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'events', label: 'Events' },
  { id: 'raw', label: 'Raw' }
]

/** A config version's own page: its record's path, then its code and version. */
export const toVersionPath = (
  { path }: Pick<RecordType, 'path'>,
  { code, version }: { code: string; version: string }
): string =>
  `${path}/${encodeURIComponent(code)}/${encodeURIComponent(version)}`
