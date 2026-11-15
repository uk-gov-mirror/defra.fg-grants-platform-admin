import type { BucketEntry } from '../use-cases/get-catalogue.use-case.ts'
import type { BucketFilters, FilterValue } from './bucket-links.ts'

/** The keys of a list's URL that are not filters. */
const rangeKeys = ['from', 'to', 'range']

type UrlQuery = Record<string, FilterValue | undefined>

/** A list's filters as its URL spells them: each fact under its declared key, a fact's several values as one key each. */
export const toUrlQuery = (
  { facts }: BucketEntry,
  filters: BucketFilters
): UrlQuery =>
  Object.fromEntries([
    ...facts.map(({ name, param }) => [param, filters[name]]),
    ...rangeKeys.map((key) => [key, filters[key]])
  ])

const byParam = ({ facts }: BucketEntry) =>
  new Map(facts.map((fact) => [fact.param, fact]))

/** The keys of a URL this list does not declare: no alias is kept for an old spelling. */
export const unknownKeys = (bucket: BucketEntry, query: UrlQuery): string[] =>
  Object.keys(query).filter(
    (key) => !byParam(bucket).has(key) && !rangeKeys.includes(key)
  )

/** The keys of a URL that name a fact taking one value, given more than once. */
export const repeatedKeys = (bucket: BucketEntry, query: UrlQuery): string[] =>
  Object.entries(query)
    .filter(
      ([key, value]) =>
        Array.isArray(value) && byParam(bucket).get(key)?.values === null
    )
    .map(([key]) => key)

/** A fact another sits within names a code, which may have no rows yet; any other offers every value it takes. */
const isClosed = (
  { facts }: BucketEntry,
  fact: BucketEntry['facts'][number]
): boolean =>
  fact.values !== null && !facts.some(({ within }) => within === fact.name)

/** The keys of a URL that give a value their fact doesn't offer. */
export const unknownValues = (bucket: BucketEntry, query: UrlQuery): string[] =>
  Object.entries(query)
    .filter(([key, value]) => {
      const fact = byParam(bucket).get(key)

      return (
        fact !== undefined &&
        isClosed(bucket, fact) &&
        listOf(value).some(
          (one) => !fact.values!.some((option) => String(option.value) === one)
        )
      )
    })
    .map(([key]) => key)

const listOf = (value: FilterValue | undefined): string[] =>
  [value ?? []].flat().filter(Boolean)

/** A fact whose values are offered may be filtered by several; any other by one, the first the address gives. */
const toFilter = (
  { values }: BucketEntry['facts'][number],
  value: FilterValue | undefined
): FilterValue | undefined =>
  values === null ? listOf(value)[0] : [...new Set(listOf(value))]

/** A URL's query as the list's filters: each declared key back to its fact. */
export const fromUrlQuery = (
  bucket: BucketEntry,
  query: UrlQuery
): BucketFilters => {
  const facts = byParam(bucket)

  return {
    ...Object.fromEntries(
      Object.entries(query)
        .filter(([key]) => facts.has(key))
        .map(([key, value]) => {
          const fact = facts.get(key)!

          return [fact.name, toFilter(fact, value)]
        })
    ),
    ...Object.fromEntries(
      Object.entries(query).filter(([key]) => rangeKeys.includes(key))
    )
  }
}
