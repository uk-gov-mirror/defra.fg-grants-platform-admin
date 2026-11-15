import type { BucketLink } from '../use-cases/query-bucket.use-case.ts'
import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { toApplicationHref } from './applications-page.view-model.ts'
import type {
  BucketEntry,
  Catalogue
} from '../use-cases/get-catalogue.use-case.ts'
import { toBucketPath } from './bucket-nav.ts'
import { toUrlQuery } from './bucket-urls.ts'
import { toCaseHref } from './cases-page.view-model.ts'
import { toEventHref } from './event-formats.ts'
import { toGrantHref } from './grants-page.view-model.ts'
import { toFilterHref } from './list-filters.ts'
import { toWorkflowHref } from './workflows-page.view-model.ts'
import { toFittingBack } from './record-filters.ts'

/** One value, or the values a fact with offered values is filtered by. */
export type FilterValue = string | string[]

/** Everything a list's URL holds but its position: one key per filtered fact, and the time range. */
export type BucketFilters = Record<string, FilterValue | undefined>

/** The list under these filters, spelled as its URL spells them; `params` goes first, as a cursor does. */
export const toBucketHref = (
  bucket: BucketEntry,
  filters: BucketFilters,
  params?: URLSearchParams
): string => {
  const query = toUrlQuery(bucket, filters)

  return toFilterHref(toBucketPath(bucket), Object.keys(query), query, params)
}

/** The facts a list names a version's code and version by. */
interface VersionFacts {
  codeFact: string
  versionFact: string
}

const declaresAll = ({ facts }: BucketEntry, names: string[]): boolean =>
  names.every((name) => facts.some((fact) => fact.name === name))

/** Null unless the list declares both facts: an undeclared one would drop out of the URL and widen the list. */
export const toVersionListHref = (
  catalogue: Catalogue | null,
  bucketId: string,
  { codeFact, versionFact }: VersionFacts,
  { code, version }: { code: string; version: string }
): string | null => {
  const bucket = catalogue?.buckets.find(({ id }) => id === bucketId)

  return bucket && declaresAll(bucket, [codeFact, versionFact])
    ? toBucketHref(bucket, { [codeFact]: code, [versionFact]: version })
    : null
}

/** The key that carries the page to go back to. */
export const backKey = 'back'

type Fields = Record<string, string>

/** Every named field as a string, or nothing: a link missing one leads nowhere. */
const fieldsOf = (link: BucketLink, names: string[]): Fields | null => {
  const entries = names.map((name) => [name, link[name]])

  return entries.every(([, value]) => typeof value === 'string')
    ? (Object.fromEntries(entries) as Fields)
    : null
}

interface Page {
  fields: string[]
  toHref: (fields: Fields) => string
}

const pages = new Map<string, Page>([
  [
    'event',
    {
      fields: ['service', 'box', 'id'],
      toHref: (fields) => toEventHref(fields as unknown as EventKey)
    }
  ],
  [
    'application',
    {
      fields: ['code', 'clientRef'],
      toHref: ({ code, clientRef }) => toApplicationHref({ code, clientRef })
    }
  ],
  [
    'case',
    {
      fields: ['workflowCode', 'caseRef'],
      toHref: ({ workflowCode, caseRef }) =>
        toCaseHref({ workflowCode, caseRef })
    }
  ],
  [
    'grant',
    {
      fields: ['code', 'version'],
      toHref: ({ code, version }) => toGrantHref({ code, version })
    }
  ],
  [
    'workflow',
    {
      fields: ['code', 'version'],
      toHref: ({ code, version }) => toWorkflowHref({ code, version })
    }
  ]
])

const toPageHref = (link: BucketLink): string | null => {
  const page = pages.get(link.kind)
  const fields = page ? fieldsOf(link, page.fields) : null

  return page && fields ? page.toHref(fields) : null
}

/** The page a row opens, told which list to go back to; a row with no page of its own is no link. */
export const toRowHref = (
  link: BucketLink | null,
  from: string
): string | null => {
  const href = link === null ? null : toPageHref(link)

  return href === null
    ? null
    : `${href}?${backKey}=${encodeURIComponent(toFittingBack(from))}`
}
