import type { Catalogue } from '../use-cases/get-catalogue.use-case.ts'
import { toDefinitionFetchNotices } from './definition-fetch.ts'
import type {
  DefinitionFetchFlash,
  DefinitionFetchNotice
} from './definition-fetch.ts'
import { toVersionPath } from './record-type.ts'
import type { RecordType } from './record-type.ts'
import type { VersionFiles, VersionFileType } from './version-banner.ts'
import { toVersionHeader } from './version-header.ts'
import type { VersionHeader } from './version-header.ts'
import type { Zone } from './zoned-clock.ts'

type HeaderInput = Parameters<typeof toVersionHeader>[1]

/** A version's own events: the service whose inbox holds them, and the version they are for. */
export interface VersionEvents {
  source: string
  code: string
  version: string
}

export interface VersionShell {
  backHref: string
  navActive: string | null
  versionHeader: VersionHeader
  version: string
  /** What the fetch that has just landed here did. */
  notices: DefinitionFetchNotice[]
  versionEvents: VersionEvents
}

/** The list each kind of version is listed in, by its catalogue id. */
const ownLists: Record<string, string> = {
  grant: 'gas.grants',
  workflow: 'cw.workflows'
}

/** A page opened from nowhere goes back to, and sits under, its own list. */
export const toVersionShell = (
  record: RecordType,
  header: HeaderInput,
  tab: string,
  from: string,
  {
    notice,
    catalogue,
    now,
    zone
  }: {
    notice?: DefinitionFetchFlash
    catalogue: Catalogue | null
    now: Date
    zone: Zone
  }
): VersionShell => ({
  backHref: from || record.path,
  navActive: ownLists[record.itemId],
  versionHeader: toVersionHeader(
    record,
    header,
    tab,
    from,
    zone,
    catalogue,
    now
  ),
  version: header.version,
  notices: toDefinitionFetchNotices(
    record,
    notice,
    toVersionPath(record, header),
    header
  ),
  versionEvents: {
    source: record.source,
    code: header.code,
    version: header.version
  }
})

/** What a tab would show, said while the file it needs is not stored: the banner says the rest. */
const waitingTexts: Record<string, string> = {
  phases: 'The statuses and moves appear once the {file} definition is stored.',
  questions: 'The questions appear once the grant definition is stored.',
  actions: 'The actions appear once the grant definition is stored.',
  entitlements:
    'Entitlement templates and claims appear once the grant definition is stored.',
  agreement:
    "The agreement's states, pages and processes appear once the agreement definition is stored.",
  payment:
    'Payment request fields appear once the payment definition is stored.',
  tasks: 'The task groups appear once the workflow definition is stored.',
  pages: 'The case pages appear once the workflow definition is stored.',
  integrations:
    'The external actions appear once the workflow definition is stored.',
  raw: 'The stored {file} definition appears here once it is stored.'
}

export interface NotStored {
  file: VersionFileType
  text: string
}

/** The file a tab needs, while it is not stored, and what the tab would show once it is. */
const toWaitingText = (tab: string, file: VersionFileType): string =>
  (
    waitingTexts[tab] ??
    'This tab appears once the {file} definition is stored.'
  ).replace('{file}', file)

/** A file the service marked Failed may never be stored, so the tab says why it is empty instead. */
const toEmptyText = (
  { files }: VersionFiles,
  tab: string,
  file: VersionFileType
): string =>
  files[file]?.fetchStatus === 'permanent_error'
    ? `The ${file} definition failed to load, so there is nothing to show. See the banner.`
    : toWaitingText(tab, file)

export const toNotStored = (
  version: VersionFiles,
  tab: string,
  file: VersionFileType | null
): NotStored | null =>
  file && version.files[file]?.stored === false
    ? { file, text: toEmptyText(version, tab, file) }
    : null
