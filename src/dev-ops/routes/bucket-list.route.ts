import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { BucketEntry } from '../use-cases/get-catalogue.use-case.ts'
import {
  getBucketAtUseCase,
  getCatalogueUseCase
} from '../use-cases/get-catalogue.use-case.ts'
import type {
  BucketListResult,
  BucketSearch
} from '../use-cases/query-bucket.use-case.ts'
import { queryBucketUseCase } from '../use-cases/query-bucket.use-case.ts'
import { summariseBucketUseCase } from '../use-cases/summarise-bucket.use-case.ts'
import { toBucketHref } from '../view-models/bucket-links.ts'
import type { BucketFilters } from '../view-models/bucket-links.ts'
import { devOpsPath, toHomeHref } from '../view-models/bucket-nav.ts'
import {
  searchError,
  toBucketPage,
  toSearchQuery
} from '../view-models/bucket-page.view-model.ts'
import type { SearchAttempt } from '../view-models/bucket-page.view-model.ts'
import {
  drawnSummaries,
  toSummarySections
} from '../view-models/bucket-summaries.ts'
import type { SummarySource } from '../view-models/bucket-summaries.ts'
import { pageMates } from '../view-models/bucket-tabs.ts'
import { shownFacts, withShown } from '../view-models/bucket-toggles.ts'
import {
  fromUrlQuery,
  unknownKeyRefusal,
  unknownKeys
} from '../view-models/bucket-urls.ts'
import { listPageCache, present } from '../view-models/list-filters.ts'
import { seeOther } from '../view-models/see-other.ts'
import {
  clearSearch,
  forgetRefused,
  peekSearch,
  storeSearch,
  takeSearch,
  toSearchKey
} from '../view-models/stored-search.ts'
import type { SearchToRun } from '../view-models/stored-search.ts'
import {
  timeRangeFilters,
  toRangeInstants
} from '../view-models/time-range.view-model.ts'
import { shellQuery, timesOf, withoutShellKeys } from '../view-models/times.ts'
import {
  catalogueUnavailableCode,
  toStatusPage
} from '../view-models/status-page.ts'
import type { Zone } from '../view-models/zoned-clock.ts'

const badRequest = 400

const cursorMax = 512

const valueMax = 200

/** Any key that could be a filter: the list knows which are, and refuses the rest. */
const urlKey = /^[A-Za-z][A-Za-z0-9.]*$/

const urlValue = Joi.string().allow('').max(valueMax)

type Filters = Record<string, string | undefined>

interface ListQuery extends Filters {
  cursor?: string
  searched?: string
}

/** Hyphenated, so neither can be taken for a fact the form carries beside it. */
const kindField = 'ref-kind'

const valueField = 'ref-value'

interface SearchPayload extends Filters {
  [kindField]: string
  [valueField]: string
}

/** An unset menu or an empty box sends an empty value, which is no filter. */
const toFilters = (
  bucket: BucketEntry,
  query: Filters,
  zone: Zone
): BucketFilters => {
  const { from, to, range, ...facts } = fromUrlQuery(bucket, query)

  return withShown(bucket, {
    ...Object.fromEntries(Object.entries(facts).filter(([, value]) => value)),
    ...toRangeInstants({ from, to }, zone),
    ...present('range', range)
  })
}

/** A key the list does not declare is refused here, as GAS refuses a fact it does not know: no alias is kept for an old spelling. */
const refusedRead: BucketListResult = {
  page: null,
  unavailable: false,
  refused: true,
  refusal: unknownKeyRefusal
}

const toShow = (filters: BucketFilters) => {
  const show = shownFacts(filters)

  return show.length ? { show } : {}
}

const toSearch = (
  filters: BucketFilters,
  cursor: string | undefined,
  search: SearchToRun
): BucketSearch => {
  const { from, to, range, show, ...where } = filters

  return {
    where: where as Record<string, string>,
    ...toShow(filters),
    ...present('ref', search.q),
    ...present('from', from),
    ...present('to', to),
    ...present('cursor', cursor)
  }
}

const browse: SearchToRun = { q: '', repeat: false, id: '' }

/**
 * A list's summaries are read with its first page, each apart, over the range
 * and shown facts the list has. A later page and a searched list draw none.
 */
const readSummaries = async (
  bucket: BucketEntry,
  filters: BucketFilters,
  { cursor, q }: { cursor: string | undefined; q: string }
): Promise<SummarySource[]> => {
  const summaries = cursor || q ? [] : drawnSummaries(bucket, filters)

  return Promise.all(
    summaries.map(async (summary) => ({
      summary,
      read: await summariseBucketUseCase(bucket, summary.id, {
        ...toShow(filters),
        ...present('from', filters.from),
        ...present('to', filters.to)
      })
    }))
  )
}

/**
 * A cursor is only a position, so a later page of a search runs the search its
 * first page ran, or none: null when that search is no longer held. A later
 * page is never a repeat.
 */
const searchFor = (
  request: Request,
  bucket: BucketEntry,
  { cursor, searched }: ListQuery,
  listHref: string
): SearchToRun | null => {
  const key = toSearchKey(bucket.id)

  if (!cursor) {
    return takeSearch(request, key, listHref)
  }

  return searched ? peekSearch(request, key, searched) : browse
}

const matesOf = async (bucket: BucketEntry): Promise<BucketEntry[]> =>
  pageMates(bucket, (await getCatalogueUseCase())?.buckets ?? [])

/** Without the catalogue no list can be drawn: the page says so, and access tokens, which need none, stay in reach. */
const viewCatalogueUnavailable = (request: Request, h: ResponseToolkit) =>
  h
    .view(
      'status',
      toStatusPage(request, catalogueUnavailableCode, 'catalogue')
    )
    .code(catalogueUnavailableCode)

const viewRefused = async (
  h: ResponseToolkit,
  bucket: BucketEntry,
  filters: BucketFilters,
  zone: Zone
) => {
  const page = toBucketPage(
    bucket,
    refusedRead,
    { filters, mates: await matesOf(bucket), zone },
    null
  )

  return h.view('bucket', {
    pageTitle: page.title,
    ...page,
    refused: page.refused && { ...page.refused, by: null }
  })
}

const viewList = async (
  request: Request,
  h: ResponseToolkit,
  bucket: BucketEntry,
  filters: BucketFilters,
  { cursor, searched }: ListQuery
) => {
  const listHref = toBucketHref(bucket, filters)
  const search = searchFor(request, bucket, { cursor, searched }, listHref)

  if (search === null) {
    return h.redirect(listHref)
  }

  const [read, summaries] = await Promise.all([
    queryBucketUseCase(
      bucket,
      toSearch(filters, cursor, search),
      search.repeat
    ),
    readSummaries(bucket, filters, { cursor, q: search.q })
  ])

  forgetRefused(request, toSearchKey(bucket.id), search, read.refused)

  const { zone } = timesOf(request)
  const page = toBucketPage(
    bucket,
    read,
    { filters, mates: await matesOf(bucket), zone },
    search
  )

  return h.view('bucket', {
    pageTitle: page.title,
    ...page,
    summaries: toSummarySections(bucket, summaries, filters, zone)
  })
}

const viewBucket = async (
  request: Request,
  h: ResponseToolkit,
  bucket: BucketEntry
) => {
  const { cursor, searched, ...rest } = withoutShellKeys(
    request.query as ListQuery
  )
  const { zone } = timesOf(request)
  const filters = toFilters(bucket, rest, zone)

  if (unknownKeys(bucket, rest).length) {
    return viewRefused(h, bucket, filters, zone)
  }

  return viewList(request, h, bucket, filters, { cursor, searched })
}

/**
 * The admin's own root opens its first list, as the catalogue orders them.
 * Found rather than moved permanently, so a browser never caches it past a
 * change of order. No other path is redirected.
 */
export const viewDevOpsRoute: ServerRoute = {
  method: 'GET',
  path: devOpsPath,
  async handler(request: Request, h: ResponseToolkit) {
    const home = toHomeHref(await getCatalogueUseCase())

    return home === null
      ? viewCatalogueUnavailable(request, h)
      : h.redirect(home)
  }
}

/** Every path below the admin's root no other route takes: a list, or a 404. */
const listPath = `${devOpsPath}/{path*}`

const toPath = (request: Request): string => request.params.path ?? ''

export const viewBucketRoute: ServerRoute = {
  method: 'GET',
  path: listPath,
  options: {
    cache: listPageCache,
    validate: {
      query: Joi.object({
        cursor: Joi.string().max(cursorMax),
        searched: Joi.string().guid(),
        ...timeRangeFilters,
        ...shellQuery
      }).pattern(urlKey, urlValue)
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { available, bucket } = await getBucketAtUseCase(toPath(request))

    if (bucket === null && available) {
      throw Boom.notFound()
    }

    return bucket === null
      ? viewCatalogueUnavailable(request, h)
      : viewBucket(request, h, bucket)
  }
}

/** What an empty box clears, or the search a typed value is; null for one that cannot be. */
const toStoredQuery = (
  bucket: BucketEntry,
  kind: string,
  typed: string
): string | null => {
  const value = typed.trim()

  return value === '' ? '' : toSearchQuery(bucket, kind, value)
}

/**
 * The search runs nothing: it keeps the identifier out of the URL, and the
 * list it redirects to reads it back. One GAS would refuse is never stored:
 * the list is drawn again, as it was, with the reason beside the box.
 */
export const searchBucketRoute: ServerRoute = {
  method: 'POST',
  path: listPath,
  options: {
    validate: {
      payload: Joi.object({
        [kindField]: Joi.string().allow('').max(valueMax).default(''),
        [valueField]: Joi.string().allow('').default(''),
        ...timeRangeFilters
      })
        .pattern(urlKey, urlValue)
        .empty(null)
        .default({ [kindField]: '', [valueField]: '' })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { bucket } = await getBucketAtUseCase(toPath(request))

    if (bucket === null) {
      throw Boom.notFound()
    }

    const {
      [kindField]: kind,
      [valueField]: typed,
      ...rest
    } = request.payload as SearchPayload
    const key = toSearchKey(bucket.id)
    const { zone } = timesOf(request)
    const filters = toFilters(bucket, rest, zone)

    if (unknownKeys(bucket, rest).length) {
      return (await viewRefused(h, bucket, filters, zone)).code(badRequest)
    }

    const href = toBucketHref(bucket, filters)
    const q = toStoredQuery(bucket, kind, typed)

    if (q === null) {
      const attempt: SearchAttempt = { kind, value: typed, error: searchError }

      clearSearch(request, key)

      const page = toBucketPage(
        bucket,
        await queryBucketUseCase(bucket, toSearch(filters, '', browse), false),
        { filters, mates: await matesOf(bucket), zone },
        null,
        new Date(),
        attempt
      )

      return h
        .view('bucket', { pageTitle: page.title, ...page })
        .code(badRequest)
    }

    storeSearch(request, key, q, href)

    return h.redirect(href).code(seeOther)
  }
}
