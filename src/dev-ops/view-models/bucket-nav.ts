import type {
  BucketEntry,
  Catalogue
} from '../use-cases/get-catalogue.use-case.ts'
import {
  clientServices,
  serviceWords,
  toClientsPath,
  toNavActive
} from './access-token-services.ts'

export const devOpsPath = '/dev-ops'

/** A list's own URL, from the path its bucket declares. */
export const toBucketPath = ({ path }: Pick<BucketEntry, 'path'>): string =>
  `${devOpsPath}/${path}`

/** The first list the catalogue names: the admin has no front page of its own. */
export const toHomeHref = (catalogue: Catalogue | null): string | null => {
  const [first] = catalogue?.buckets ?? []

  return first ? toBucketPath(first) : null
}

interface NavItem {
  id: string
  /** Every list the link stands for: it is the current one on any of them. */
  ids: string[]
  label: string
  /** A page every service has (its events, its access tokens): read with its service, as the links are named alike. */
  perService: boolean
  href: string
  icon: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

/** A list that declares no icon is drawn with this one. */
const fallbackIcon = 'folder'

const toKey = ({ id, page }: BucketEntry): string =>
  page === null ? `list:${id}` : `page:${page.id}`

/** Event lists live under `events/`, whatever the catalogue calls their link. */
export const isEventList = ({ path }: BucketEntry): boolean =>
  path.startsWith('events/')

const toNavItem = (bucket: BucketEntry): NavItem => ({
  id: bucket.id,
  ids: [],
  label: bucket.page?.shortLabel ?? bucket.shortLabel,
  perService: isEventList(bucket),
  href: toBucketPath(bucket),
  icon: bucket.icon ?? fallbackIcon
})

/** One link per page: a list with a page of its own, or the lists that share one, opening on the first. */
const toNavItems = (buckets: BucketEntry[]): NavItem[] => {
  const items = new Map<string, NavItem>()

  for (const bucket of buckets) {
    const item = items.get(toKey(bucket)) ?? toNavItem(bucket)

    items.set(toKey(bucket), { ...item, ids: [...item.ids, bucket.id] })
  }

  return [...items.values()]
}

/** Not a bucket: a page of its own, so it is there whether or not the catalogue answers. */
const toAccessTokensItem = (service: 'gas' | 'cw'): NavItem => ({
  id: toNavActive(service),
  ids: [toNavActive(service)],
  label: 'Access tokens',
  perService: true,
  href: toClientsPath(service),
  icon: 'key'
})

/** Last in its service's section, which is made when the catalogue names none. */
const withItem = (
  sections: NavSection[],
  title: string,
  item: NavItem
): NavSection[] =>
  sections.some((section) => section.title === title)
    ? sections.map((section) =>
        section.title === title
          ? { ...section, items: [...section.items, item] }
          : section
      )
    : [...sections, { title, items: [item] }]

/**
 * GAS answered without CW's lists because it couldn't reach CW: CW's Events
 * stays in reach, where the page says so.
 */
const cwEventsItem: NavItem = {
  id: 'cw.outbox',
  ids: ['cw.outbox', 'cw.inbox'],
  label: 'Events',
  perService: true,
  href: `${devOpsPath}/events/cw/outbox`,
  icon: 'activity'
}

const cwUnreachable = (catalogue: Catalogue | null): boolean =>
  (catalogue?.sourceErrors ?? []).some(({ hop }) => hop === 'CW-BE')

const hasCwLists = (sections: NavSection[]): boolean =>
  sections.some(({ title }) => title === serviceWords.cw.short)

const withUnreachable = (
  catalogue: Catalogue | null,
  sections: NavSection[]
) =>
  cwUnreachable(catalogue) && !hasCwLists(sections)
    ? [...sections, { title: serviceWords.cw.short, items: [cwEventsItem] }]
    : sections

/** One section per service, in the order the catalogue first names it, each ending with that service's access tokens. */
export const toNavSections = (catalogue: Catalogue | null): NavSection[] => {
  const buckets = catalogue?.buckets ?? []
  const services = [...new Set(buckets.map(({ service }) => service))]
  const sections = services.map((title) => ({
    title,
    items: toNavItems(buckets.filter(({ service }) => service === title))
  }))

  return clientServices.reduce(
    (drawn, service) =>
      withItem(drawn, serviceWords[service].short, toAccessTokensItem(service)),
    withUnreachable(catalogue, sections)
  )
}

/** A record's page carries the list it was opened from as its own `back`. */
const toInnerBack = (back: string): string =>
  new URL(back, 'http://record').searchParams.get('back') ?? ''

const pathOf = (href: string): string => new URL(href, 'http://list').pathname

const listAt = (buckets: BucketEntry[], href: string): BucketEntry | null =>
  href === ''
    ? null
    : (buckets.find((bucket) => toBucketPath(bucket) === pathOf(href)) ?? null)

/** The list a `back` is, itself; null for any other page. */
export const toListAt = (
  catalogue: Catalogue | null,
  back: string
): BucketEntry | null => listAt(catalogue?.buckets ?? [], back)

/** The list a `back` leads to, directly or by way of a record's page: the list a detail page belongs under. */
export const toBackBucket = (
  catalogue: Catalogue | null,
  back: string
): BucketEntry | null => {
  const buckets = catalogue?.buckets ?? []

  return listAt(buckets, back) ?? listAt(buckets, toInnerBack(back))
}

/** What the front door is called on a button: the first list's page, or the list itself. */
export const toHomeLabel = (catalogue: Catalogue | null): string | null => {
  const [first] = catalogue?.buckets ?? []

  return first ? toPageLabel(first) : null
}

/** A list by the page it is drawn on: a queue by its service's events, the others by their own name. */
export const toListLabel = ({ page, label }: BucketEntry): string =>
  page?.label ?? label

const toPageLabel = toListLabel
