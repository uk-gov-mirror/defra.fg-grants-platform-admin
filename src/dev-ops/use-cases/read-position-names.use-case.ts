import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { findWorkflowVersionPage } from '../repositories/workflows.repository.ts'
import { readGrantStatusMap } from './grant-status-map.ts'
import { readRecord } from './record-reads.ts'
import type { RecordResult } from './record-reads.ts'

interface Named {
  code: string
  name: string | null
}

/** A definition's phases in order, each with its stages and their statuses: codes and names, nothing else. */
export interface PositionNames {
  phases: (Named & { stages: (Named & { statuses: Named[] })[] })[]
}

export interface VersionedCode {
  code: string
  version: string | null
}

// GAS sends position codes only. Until it sends names with each record, GPA reads
// the definition of the version the record is on. Retired when GAS adds names to
// the record answers' headers.
const foundForMs = 60 * 1000

/** A failed read is tried again soon, not on every page while the service struggles. */
const missedForMs = 10 * 1000

const maxKept = 200

/** The page draws without names (codes made readable) rather than wait longer than this for them. */
export const namesBudgetMs = 2000

interface Kept {
  names: PositionNames | null
  until: number
}

/** Oldest first: a hit moves its key to the end, and the first key is dropped past the cap. */
const kept = new Map<string, Kept>()
const reading = new Map<string, Promise<PositionNames | null>>()

export const forgetPositionNames = (): void => {
  kept.clear()
  reading.clear()
}

const recall = (key: string): Kept | undefined => {
  const known = kept.get(key)

  if (!known) {
    return undefined
  }

  kept.delete(key)

  if (known.until <= Date.now()) {
    return undefined
  }

  kept.set(key, known)

  return known
}

const dropExpired = (now: number): void => {
  for (const [key, { until }] of kept) {
    if (until <= now) {
      kept.delete(key)
    }
  }
}

const dropOldest = (): void => {
  while (kept.size > maxKept) {
    kept.delete(kept.keys().next().value!)
  }
}

const keep = (key: string, names: PositionNames | null): void => {
  const now = Date.now()

  dropExpired(now)
  kept.set(key, { names, until: now + (names ? foundForMs : missedForMs) })
  dropOldest()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const toNamed = (value: unknown): Named | null => {
  if (!isRecord(value) || typeof value.code !== 'string') {
    return null
  }

  return {
    code: value.code,
    name: typeof value.name === 'string' ? value.name : null
  }
}

/** Every item named, or null if any isn't: half a list would place the record wrongly. */
const allOf = <T>(value: unknown, to: (item: unknown) => T | null) => {
  if (!Array.isArray(value)) {
    return null
  }

  const items = value.map(to)

  return items.every((item) => item !== null) ? (items as T[]) : null
}

const toStage = (value: unknown) => {
  const named = toNamed(value)
  const statuses =
    named && allOf((value as { statuses?: unknown }).statuses, toNamed)

  return named && statuses ? { ...named, statuses } : null
}

const toPhase = (value: unknown) => {
  const named = toNamed(value)
  const stages = named && allOf((value as { stages?: unknown }).stages, toStage)

  return named && stages ? { ...named, stages } : null
}

/** The stored definition is passed through unchecked, so anything but the expected shape is no names. */
export const toPositionNames = (phases: unknown): PositionNames | null => {
  const checked = allOf(phases, toPhase)

  return checked ? { phases: checked } : null
}

const checkedNames = (key: string, phases: unknown): PositionNames | null => {
  const names = toPositionNames(phases)

  if (!names) {
    logger.warn(`The ${key} definition has phases GPA cannot read`)
  }

  return names
}

const readGrantNames = async (
  code: string,
  version: string
): Promise<PositionNames | null> => {
  const map = await readGrantStatusMap({ code, version })

  return map.outcome === 'found'
    ? checkedNames(`grant ${code}@${version}`, map.lifecycle.phases)
    : null
}

const readWorkflowNames = async (
  code: string,
  version: string
): Promise<PositionNames | null> => {
  const { page } = await readRecord(
    'workflow version',
    () => findWorkflowVersionPage({ code, version }, 'definition'),
    'WORKFLOW_VERSION_NOT_FOUND'
  )

  return page?.definition
    ? checkedNames(
        `workflow ${code}@${version}`,
        page.definition.workflow?.phases
      )
    : null
}

const settle = async (
  key: string,
  read: () => Promise<PositionNames | null>
): Promise<PositionNames | null> => {
  try {
    return await read()
  } catch (error) {
    logger.warn(
      `Could not read the ${key} phase names: ${describeError(error)}`
    )

    return null
  }
}

/** One read per version at a time; what it found is kept a minute, a miss a few seconds. */
const cached = async (
  key: string,
  read: () => Promise<PositionNames | null>
): Promise<PositionNames | null> => {
  const known = recall(key)

  if (known) {
    return known.names
  }

  const inFlight =
    reading.get(key) ??
    settle(key, read).then((names) => {
      keep(key, names)
      reading.delete(key)

      return names
    })

  reading.set(key, inFlight)

  return inFlight
}

/** An application's phases, stages and statuses are its grant version's; a record with no version has none to read. */
export const readApplicationPositionNames = async ({
  code,
  version
}: VersionedCode): Promise<PositionNames | null> =>
  version
    ? cached(`grant ${code}@${version}`, () => readGrantNames(code, version))
    : null

/** A case's are its workflow version's, which CW holds and GAS reads. */
export const readCasePositionNames = async ({
  code,
  version
}: VersionedCode): Promise<PositionNames | null> =>
  version
    ? cached(`workflow ${code}@${version}`, () =>
        readWorkflowNames(code, version)
      )
    : null

/** The names, or none once the budget is spent: the read carries on, and the next page gets what it found. */
const withinBudget = (
  read: Promise<PositionNames | null>,
  budgetMs: number
): Promise<PositionNames | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined

  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs)
  })

  return Promise.race([read, late]).finally(() => clearTimeout(timer))
}

const namesOf = async (
  version: VersionedCode | null,
  read: (version: VersionedCode) => Promise<PositionNames | null>,
  budgetMs: number
): Promise<PositionNames | null> =>
  version?.version ? withinBudget(read(version), budgetMs) : null

/** A found record with the names of where it is beside it; only Overview carries the version to read them by. */
export const withPositionNames = async <P>(
  result: RecordResult<P>,
  versionOf: (page: P) => VersionedCode | null,
  read: (version: VersionedCode) => Promise<PositionNames | null>,
  budgetMs: number = namesBudgetMs
): Promise<RecordResult<P & { names: PositionNames | null }>> => {
  if (result.page === null) {
    return { outcome: result.outcome, page: null }
  }

  return {
    outcome: result.outcome,
    page: {
      ...result.page,
      names: await namesOf(versionOf(result.page), read, budgetMs)
    }
  }
}
