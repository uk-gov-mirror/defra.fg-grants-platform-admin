import type { RecordTab } from '../use-cases/record-reads.ts'
import { backKey } from './bucket-links.ts'
import type { EventsTab, TabNotice } from './record-events-tab.ts'
import { toFittingBack } from './record-filters.ts'
import { toTabHref, toTabs } from './record-page.view-model.ts'
import type { RawTab } from './record-raw-tab.ts'
import type { RecordType } from './record-type.ts'
import type { Times } from './times.ts'
import type { Catalogue } from '../use-cases/get-catalogue.use-case.ts'

export interface RecordAlert {
  title: string
  text: string
  action: { text: string; href: string } | null
}

/** Where the other service's record is, or why there's nothing to open. */
export type CounterpartCard =
  | { kind: 'link'; title: string; text: string; button: Button }
  | {
      kind: 'missing'
      title: string
      empty: { icon: string; title: string; text: string }
      button: Button | null
    }

interface Button {
  text: string
  href: string
}

/** `code@version`, a link to that version; or the code alone, said to have no version, with nothing to open. */
export type VersionLink =
  | { text: string; href: string }
  | { text: string; href: null }

export interface RecordTabItem {
  text: string
  href: string
  current: boolean
}

/** One application's or case's page: what the two share, and the Overview each draws its own way. */
export interface RecordView<O> {
  record: RecordType
  /** The bucket the page was opened from, which is where it sits in the navigation. */
  navActive: string | null
  ref: string
  backHref: string
  /** Null where the record has no status. */
  status: string | null
  tab: RecordTab
  tabs: RecordTabItem[]
  alert: RecordAlert | null
  overview: O | TabNotice | null
  events: EventsTab | null
  raw: RawTab | null
}

export interface PageOptions {
  /** The list the record was opened from; empty when none. */
  from: string
  times: Times
  catalogue: Catalogue | null
}

type Bodies<O> = Pick<RecordView<O>, 'alert' | 'overview' | 'events' | 'raw'>

/** Only the open tab is read, so only it has a body; the alert is Overview's. */
export type TabBodies<P, O> = (
  page: P,
  options: PageOptions,
  tabHref: string
) => Partial<Bodies<O>>

export const noTabBodies: Bodies<never> = {
  alert: null,
  overview: null,
  events: null,
  raw: null
}

export const toRecordTabs = (
  record: RecordType,
  href: string,
  tab: RecordTab,
  from: string
): RecordTabItem[] =>
  toTabs(record, href, tab, from).map(({ label, href: tabHref, active }) => ({
    text: label,
    href: tabHref,
    current: active
  }))

/** With no list to go back to, Back goes to the record's own. */
export const toBackHref = (record: RecordType, from: string): string =>
  from || record.path

/** A link from this record that comes back to its Overview. */
export const toLinkBack = (
  href: string,
  recordHref: string,
  from: string
): string =>
  `${href}?${backKey}=${encodeURIComponent(toFittingBack(toTabHref(recordHref, 'overview', from)))}`

/** The version the record is on, written `code@version`, else the code and that there's none. */
export const toVersionLink = (
  code: string,
  version: string | null,
  toVersionHref: (ref: { code: string; version: string }) => string,
  recordHref: string,
  from: string
): VersionLink =>
  version
    ? {
        text: `${code}@${version}`,
        href: toLinkBack(toVersionHref({ code, version }), recordHref, from)
      }
    : { text: `${code}, version not recorded`, href: null }
