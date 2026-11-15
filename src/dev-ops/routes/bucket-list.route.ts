import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type {
  BucketEntry,
  Catalogue
} from '../use-cases/get-catalogue.use-case.ts'
import {
  getBucketAtUseCase,
  getCatalogueUseCase
} from '../use-cases/get-catalogue.use-case.ts'
import type {
  BucketListResult,
  BucketSearch
} from '../use-cases/query-bucket.use-case.ts'
import { queryBucketUseCase } from '../use-cases/query-bucket.use-case.ts'
import { toBucketHref } from '../view-models/bucket-links.ts'
import type { BucketFilters } from '../view-models/bucket-links.ts'
import { devOpsPath } from '../view-models/bucket-nav.ts'
import {
  fromUrlQuery,
  repeatedKeys,
  unknownKeys,
  unknownValues
} from '../view-models/bucket-urls.ts'
import { listPageCache, present } from '../view-models/list-filters.ts'
import {
  badRequest,
  caseworkingUnreachableCode,
  clearParam,
  toCaseworkingUnreachable,
  toListPage,
  toListStatusCode
} from '../view-models/list-page.view-model.ts'
import type {
  ListPageInput,
  SearchAttempt
} from '../view-models/list-page.view-model.ts'
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
import type { TimeRangeQuery } from '../view-models/time-range.view-model.ts'
import { shellQuery, timesOf, withoutShellKeys } from '../view-models/times.ts'
import {
  catalogueUnavailableCode,
  toStatusPage
} from '../view-models/status-page.ts'
import type { Zone } from '../view-models/zoned-clock.ts'

const cursorMax = 512

const valueMax = 200

/** Any key that could be a filter: the list knows which are, and refuses the rest. */
const urlKey = /^[A-Za-z][A-Za-z0-9.]*$/

const urlValue = Joi.string().allow('').max(valueMax)

/** The most values one filter takes, as GAS does. */
const valuesMax = 20

/** A repeated key is a filter with several values. */
const urlValues = Joi.alternatives(
  urlValue,
  Joi.array().items(urlValue).max(valuesMax)
)

type Filters = Record<string, string | string[] | undefined>

interface ListQuery extends Filters {
  cursor?: string
  searched?: string
  [clearParam]?: string
}

/** Hyphenated, so neither can be taken for a fact the form carries beside it. */
const kindField = 'ref-kind'

const valueField = 'ref-value'

interface SearchPayload extends Filters {
  [kindField]: string
  [valueField]: string
}

/**
 * An unset menu or an empty box sends an empty value, which is no filter. The
 * range is kept as the address spells it, days and all, so every link carries
 * it so; it is read as instants.
 */
const toFilters = (bucket: BucketEntry, query: Filters): BucketFilters =>
  Object.fromEntries(
    Object.entries(fromUrlQuery(bucket, query)).filter(
      ([, value]) => value?.length
    )
  )

/** One value as itself, several as a list. */
const toWhere = (facts: BucketFilters): Record<string, string | string[]> =>
  Object.fromEntries(
    Object.entries(facts).flatMap(([name, value]) => {
      const values = [value ?? []].flat()

      return values.length
        ? [[name, values.length === 1 ? values[0] : values]]
        : []
    })
  )

const toSearch = (
  filters: BucketFilters,
  zone: Zone,
  cursor: string | undefined,
  q: string
): BucketSearch => {
  const { from, to, range, ...facts } = filters

  return {
    where: toWhere(facts),
    ...present('ref', q),
    ...toRangeInstants({ from, to } as TimeRangeQuery, zone),
    ...present('cursor', cursor)
  }
}

const browse: SearchToRun = { q: '', repeat: false, id: '' }

/** Nothing was read: the address named a filter the list doesn't declare. */
const notRead: BucketListResult = {
  page: null,
  unavailable: false,
  timedOut: false,
  errored: false,
  refused: false,
  refusal: null
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

/** Without the catalogue no list can be drawn: the page says so, and access tokens, which need none, stay in reach. */
const viewCatalogueUnavailable = (request: Request, h: ResponseToolkit) =>
  h
    .view(
      'status',
      toStatusPage(request, catalogueUnavailableCode, 'catalogue')
    )
    .code(catalogueUnavailableCode)

const draw = async (
  h: ResponseToolkit,
  input: Omit<ListPageInput, 'buckets'>
) => {
  const full = {
    ...input,
    buckets: (await getCatalogueUseCase())?.buckets ?? [input.bucket]
  }

  return h.view('list', toListPage(full)).code(toListStatusCode(full))
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

  const times = timesOf(request)
  const read = await queryBucketUseCase(
    bucket,
    toSearch(filters, times.zone, cursor, search.q),
    search.repeat
  )

  forgetRefused(request, toSearchKey(bucket.id), search, read.refused)

  return read.refused && search.q
    ? viewWithoutSearch(h, { bucket, filters, times, refusal: read.refusal })
    : draw(h, { bucket, read, filters, times, search, cursor })
}

/**
 * A refused search would only fail again: it is cleared, and its list's first
 * page is read without it, so the rows show under the refusal. A read that
 * fails too says so itself, as any list would.
 */
const viewWithoutSearch = async (
  h: ResponseToolkit,
  {
    bucket,
    filters,
    times,
    refusal
  }: Pick<ListPageInput, 'bucket' | 'filters' | 'times'> & {
    refusal: string | null
  }
) => {
  const again = await queryBucketUseCase(
    bucket,
    toSearch(filters, times.zone, undefined, ''),
    false
  )

  return draw(h, {
    bucket,
    read: again,
    filters,
    times,
    search: null,
    ...(again.page ? { refusal: { kind: 'search', message: refusal } } : {})
  })
}

const viewRefusedAddress = (
  h: ResponseToolkit,
  request: Request,
  bucket: BucketEntry,
  filters: BucketFilters
) =>
  draw(h, {
    bucket,
    read: notRead,
    filters,
    times: timesOf(request),
    search: null,
    refusal: { kind: 'address' }
  })

/** The audit switch's key, from links made before audit was one more event type. */
const retiredKeys = ['audit']

const withoutRetired = (query: Filters): Filters =>
  Object.fromEntries(
    Object.entries(query).filter(([key]) => !retiredKeys.includes(key))
  )

/** An old link that is readable once its retired keys are gone. */
const isRetiredLink = (bucket: BucketEntry, query: Filters): boolean =>
  retiredKeys.some((key) => key in query) &&
  isReadable(bucket, withoutRetired(query))

/** Every key is the list's own, a fact that takes one value has one, and every value is one its fact offers. */
const isReadable = (bucket: BucketEntry, query: Filters): boolean =>
  [unknownKeys, repeatedKeys, unknownValues].every(
    (problems) => problems(bucket, query).length === 0
  )

const viewBucket = async (
  request: Request,
  h: ResponseToolkit,
  bucket: BucketEntry
) => {
  const {
    cursor,
    searched,
    [clearParam]: clear,
    ...rest
  } = withoutShellKeys(request.query as ListQuery)
  const filters = toFilters(bucket, rest)

  if (clear) {
    clearSearch(request, toSearchKey(bucket.id))

    return h.redirect(toBucketHref(bucket, filters))
  }

  if (isRetiredLink(bucket, rest)) {
    return h.redirect(toBucketHref(bucket, filters))
  }

  if (!isReadable(bucket, rest)) {
    return viewRefusedAddress(h, request, bucket, filters)
  }

  return viewList(request, h, bucket, filters, { cursor, searched })
}

/** Every path below the admin's root no other route takes: a list, or a 404. */
const listPath = `${devOpsPath}/{path*}`

const toPath = (request: Request): string => request.params.path ?? ''

const cwEvents = /^events\/cw\/(outbox|inbox)$/

/** GAS answered, but couldn't reach CW, so CW's lists are missing from the catalogue. */
const isCaseworkingUnreachable = (
  catalogue: Catalogue | null,
  path: string
): boolean =>
  cwEvents.test(path) &&
  (catalogue?.sourceErrors ?? []).some(({ hop }) => hop === 'CW-BE')

const viewCaseworkingUnreachable = (request: Request, h: ResponseToolkit) =>
  h
    .view(
      'list',
      toCaseworkingUnreachable(
        `cw.${cwEvents.exec(toPath(request))?.[1]}`,
        `${request.url.pathname}${request.url.search}`
      )
    )
    .code(caseworkingUnreachableCode)

export const viewBucketRoute: ServerRoute = {
  method: 'GET',
  path: listPath,
  options: {
    cache: listPageCache,
    validate: {
      query: Joi.object({
        cursor: Joi.string().max(cursorMax),
        searched: Joi.string().guid(),
        [clearParam]: Joi.string().valid('all'),
        ...timeRangeFilters,
        ...shellQuery
      }).pattern(urlKey, urlValues)
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { available, bucket } = await getBucketAtUseCase(toPath(request))

    if (bucket !== null) {
      return viewBucket(request, h, bucket)
    }

    if (
      isCaseworkingUnreachable(await getCatalogueUseCase(), toPath(request))
    ) {
      return viewCaseworkingUnreachable(request, h)
    }

    if (available) {
      throw Boom.notFound()
    }

    return viewCatalogueUnavailable(request, h)
  }
}

const searchable = /^[A-Za-z0-9._:@-]{1,200}$/

/** A box GAS would refuse: said beside the box, and never stored. */
export const searchError =
  'Enter an identifier using only letters, numbers and . _ : @ -'

/** What is stored for a search, or null for a kind the bucket has not got or a value it could not hold. */
export const toSearchQuery = (
  { refs }: BucketEntry,
  kind: string,
  value: string
): string | null =>
  refs.some((ref) => ref.kind === kind) && searchable.test(value)
    ? `${kind}:${value}`
    : null

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
        .pattern(urlKey, urlValues)
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
    const times = timesOf(request)
    const filters = toFilters(bucket, rest)

    if (!isReadable(bucket, rest)) {
      return viewRefusedAddress(h, request, bucket, filters)
    }

    const href = toBucketHref(bucket, filters)
    const q = toStoredQuery(bucket, kind, typed)

    if (q === null) {
      const attempt: SearchAttempt = { kind, value: typed, error: searchError }

      clearSearch(request, key)

      return (
        await draw(h, {
          bucket,
          read: await queryBucketUseCase(
            bucket,
            toSearch(filters, times.zone, undefined, ''),
            false
          ),
          filters,
          times,
          search: null,
          attempt
        })
      ).code(badRequest)
    }

    storeSearch(request, key, q, href)

    return h.redirect(href).code(seeOther)
  }
}
