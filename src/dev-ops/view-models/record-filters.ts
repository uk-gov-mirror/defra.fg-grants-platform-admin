import Joi from 'joi'
import type { Schema } from 'joi'

import type { RecordType } from './record-type.ts'

const refMax = 100

/** GAS's own spelling of a grant or workflow code, and of a reference. */
const slug = /^[a-z0-9-]+$/

export const slugFilterSchema = Joi.string().max(refMax).pattern(slug)

const workflowCodeMax = 128

/** CW's spelling of a workflow code, capitals included. */
export const workflowCodeSchema = Joi.string()
  .max(workflowCodeMax)
  .pattern(/^[a-zA-Z0-9-]+$/)

const versionMax = 32

/** A config version, as the config broker publishes it. */
export const versionSchema = Joi.string()
  .max(versionMax)
  .pattern(/^\d+\.\d+\.\d+$/)

/** Longer than any list link this app builds for itself, and still bounded. */
export const fromMax = 2048

// Checked by `toSafeFrom`: a bad one falls back to the admin's root, not an error page.
export const backSchema = Joi.string().allow('').max(fromMax)

/** Bounds the query; real positions are far shorter. */
const positionMax = 512

// Anything up to the bound that the state graph cannot place selects the first status.
export const statusSchema = Joi.string().allow('').max(positionMax)

export const recordTabSchema = ({ tabs }: RecordType) =>
  Joi.string().valid(...tabs.map(({ id }) => id))

/** Every param a record's URL names is required. */
export const recordParamsSchema = (params: Record<string, Schema>) =>
  Joi.object(
    Object.fromEntries(
      Object.entries(params).map(([name, schema]) => [name, schema.required()])
    )
  )

const backKey = 'back'

const carriesBack = (href: string): boolean =>
  new URL(href, 'http://record').searchParams.has(backKey)

/** The `back` a `back` carries, dropped from its innermost page, so a long trail still fits the schema. */
const dropInnermostBack = (back: string): string => {
  const url = new URL(back, 'http://record')
  const inner = url.searchParams.get(backKey)

  if (inner === null) {
    return url.pathname
  }

  const shorter = carriesBack(inner) ? dropInnermostBack(inner) : ''

  if (shorter === '') {
    url.searchParams.delete(backKey)
  } else {
    url.searchParams.set(backKey, shorter)
  }

  return `${url.pathname}${url.search}`
}

/** A `back` short enough to pass `backSchema`: its innermost `back` goes first, then the next. */
export const toFittingBack = (back: string): string =>
  back.length <= fromMax ? back : toFittingBack(dropInnermostBack(back))

/** A part that is not valid percent-encoding is named as written, never an error page. */
const decode = (part: string): string => {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** The pages a `back` can lead to besides a list, each named the way its Back link says it. */
const backPages: [RegExp, (parts: string[]) => string][] = [
  [/^\/dev-ops\/applications\/[^/]+\/[^/]+$/, () => 'application'],
  [/^\/dev-ops\/cases\/[^/]+\/[^/]+$/, () => 'case'],
  [
    /^\/dev-ops\/grants\/([^/]+)\/([^/]+)$/,
    ([code, version]) => `grant ${decode(code)}@${decode(version)}`
  ],
  [
    /^\/dev-ops\/workflows\/([^/]+)\/([^/]+)$/,
    ([code, version]) => `workflow ${decode(code)}@${decode(version)}`
  ],
  [/^\/dev-ops\/events\/[^/]+\/[^/]+\/[^/]+$/, () => 'event']
]

/**
 * "Back to" what `back` leads to: the record or event it names, or the list,
 * by the label the list gives it; else the page's own list.
 */
export const toBackLabel = (
  back: string,
  {
    listLabel,
    ownListLabel
  }: { listLabel: string | null; ownListLabel: string }
): string => {
  const path = back.split('?')[0]

  for (const [pattern, name] of backPages) {
    const match = pattern.exec(path)

    if (match) {
      return `Back to ${name(match.slice(1))}`
    }
  }

  return `Back to ${listLabel ?? ownListLabel}`
}
