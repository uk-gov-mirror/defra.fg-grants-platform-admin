import type {
  ExternalStatusMapping,
  GrantLifecycle,
  WayIn
} from '../use-cases/get-grant-page.use-case.ts'
import {
  isRunning,
  knowsEffects,
  runsOf,
  toStatusRef,
  toStatusSetters
} from './lifecycle-effects.ts'
import type { StatusRef, StatusSetter } from './lifecycle-effects.ts'
import {
  sourceLabel,
  stageCodeOf,
  stageKeyOf,
  toLifecycleNames
} from './lifecycle-names.ts'
import type { LifecycleNames } from './lifecycle-names.ts'
import { toTabHref } from './record-page.view-model.ts'
import { firstByPosition, pickPosition, toPhasesForm } from './state-map.ts'
import type { MapPhase, MapState, PhasesForm } from './state-map.ts'

type Move = Extract<WayIn, { kind: 'move' }>

type WayInRow =
  | { kind: 'move'; from: StatusRef }
  | { kind: 'code'; code: string }
  | { kind: 'any' }

type TriggerRow =
  | {
      kind: 'external'
      source: string
      /** The source is none GAS names. */
      unknown: boolean
      code: string
      href: string | null
      stageName: string
      /** The stage this version has not got, for a mapping only an earlier version's applications can meet. */
      missingStage: string | null
    }
  | { kind: 'claim'; at: StatusRef; href: string }
  | {
      kind: 'gas'
      process: string
      onEntering: string
      onlyWhen: string | null
    }

/** What GAS runs on entering the status: its processes, nothing (a move only), or not said (no move leads in). */
type Runs = { kind: 'processes'; processes: string[] } | { kind: 'move-only' }

/** A position a GAS process sets that the grant does not define. */
interface UndefinedTarget {
  position: string
  onlyWhen: string | null
}

export interface StatusPanel {
  id: string
  name: string
  badges: ('initial' | 'amendable')[]
  phase: string
  stage: string
  runs: Runs | null
  undefinedTargets: UndefinedTarget[]
  waysIn: WayInRow[]
  waysOut: StatusRef[]
  triggeredBy: TriggerRow[]
  /** What an empty Triggered by says; null says nothing. */
  noTrigger: 'initial' | 'nothing' | null
}

export type GrantPhasesTab =
  | {
      kind: 'map'
      selected: string
      phases: MapPhase[]
      panels: StatusPanel[]
      form: PhasesForm
    }
  | { kind: 'unreadable'; problem: string }

interface GrantPhasesOptions {
  /** The `status` query value. */
  status: string | undefined
  /** The version's own page. */
  href: string
  from: string
  /** Null when CW lacks this workflow version or cannot say. */
  workflowHref: ((cwStatus: string, back: string) => string) | null
}

interface Place {
  position: string
  phase: GrantLifecycle['phases'][number]
  stage: GrantLifecycle['phases'][number]['stages'][number]
}

interface Context {
  lifecycle: GrantLifecycle
  names: LifecycleNames
  setters: StatusSetter[]
  knows: boolean
  hrefOf: (position: string) => string
}

const isMove = (wayIn: WayIn): wayIn is Move => wayIn.kind === 'move'

const placesOf = ({ phases }: GrantLifecycle): Place[] =>
  phases.flatMap((phase) =>
    phase.stages.flatMap((stage) =>
      stage.statuses.map(({ code }) => ({
        position: `${phase.code}:${stage.code}:${code}`,
        phase,
        stage
      }))
    )
  )

const waysInto = ({ lifecycle }: Context, position: string) =>
  lifecycle.waysIn.filter(({ to }) => to === position)

/** An unmatched `validFrom` entry never runs, so only the ways GAS takes count. */
const toRuns = (context: Context, position: string): Runs | null => {
  const ways = waysInto(context, position).filter(isRunning)
  const processes = [
    ...new Set(ways.flatMap((way) => runsOf(way, context.knows)))
  ]

  if (processes.length) {
    return { kind: 'processes', processes }
  }

  return ways.length ? { kind: 'move-only' } : null
}

const isSet = ({ setters }: Context, position: string) =>
  setters.some(({ to }) => to === position)

const mapKinds: Record<Runs['kind'], MapState['kind']> = {
  processes: 'process',
  'move-only': 'move'
}

const toMapState =
  (context: Context) =>
  ({ position }: Place): MapState => {
    const runs = toRuns(context, position)
    const flagged = context.knows && !isSet(context, position)
    const initial = position === context.lifecycle.initialPosition

    return {
      id: position,
      label: context.names.status(position),
      tone: 'neutral',
      ...(runs ? { kind: mapKinds[runs.kind] } : {}),
      ...(initial ? { badge: 'initial' } : {}),
      ...toMapIcon(runs, flagged)
    }
  }

/** A warning outranks the process cog: one icon fits a state. */
const toMapIcon = (
  runs: Runs | null,
  flagged: boolean
): Pick<MapState, 'icon' | 'iconLabel' | 'iconTone'> => {
  if (flagged) {
    return {
      icon: 'triangle-alert',
      iconLabel: 'Nothing in this version sets it',
      iconTone: 'warning'
    }
  }

  return runs?.kind === 'processes'
    ? { icon: 'cog', iconLabel: `Runs ${runs.processes.join(', ')}` }
    : {}
}

/** Each position once, where it first appears, as GAS takes it. */
const toMapPhases = (context: Context, first: Set<Place>): MapPhase[] =>
  context.lifecycle.phases.map((phase) => ({
    id: phase.code,
    label: context.names.phase(phase.code),
    stages: phase.stages.map((stage) => ({
      id: `${phase.code}:${stage.code}`,
      label: context.names.stage(`${phase.code}:${stage.code}`),
      states: [...first]
        .filter((place) => place.phase === phase && place.stage === stage)
        .map(toMapState(context))
    }))
  }))

const refFor =
  ({ names, hrefOf }: Context, selected: string) =>
  (position: string): StatusRef =>
    toStatusRef(selected, position, {
      name: names.status(position),
      stageName: names.stage(stageKeyOf(position)),
      repeated: names.repeated(position),
      href: hrefOf(position)
    })

const toWayIn =
  (refOf: (position: string) => StatusRef) =>
  (wayIn: WayIn): WayInRow => {
    if (wayIn.kind === 'move') {
      return { kind: 'move', from: refOf(wayIn.from) }
    }

    return wayIn.kind === 'unmatched'
      ? { kind: 'code', code: wayIn.code }
      : { kind: 'any' }
  }

const unknownSource = /^unknown source/

/** @param back Where a link to the workflow comes back to. */
const toExternal =
  (
    { names }: Context,
    back: string,
    workflowHref: GrantPhasesOptions['workflowHref']
  ) =>
  ({ source, code, whileIn }: ExternalStatusMapping): TriggerRow => ({
    kind: 'external',
    source: sourceLabel(source),
    unknown: unknownSource.test(sourceLabel(source)),
    code,
    href: source === 'CW' && workflowHref ? workflowHref(code, back) : null,
    stageName: names.stage(whileIn),
    missingStage: names.stages.has(whileIn) ? null : stageCodeOf(whileIn)
  })

interface TriggerLinks {
  workflowHref: GrantPhasesOptions['workflowHref']
  entitlementsHref: string
}

const toTriggerRow =
  (context: Context, position: string, links: TriggerLinks) =>
  (setter: StatusSetter): TriggerRow[] => {
    if (setter.kind === 'external') {
      return [
        toExternal(
          context,
          context.hrefOf(position),
          links.workflowHref
        )(setter.mapping)
      ]
    }

    if (setter.kind === 'claim') {
      return [
        {
          kind: 'claim',
          at: refFor(context, position)(setter.from),
          href: links.entitlementsHref
        }
      ]
    }

    return setter.kind === 'gas'
      ? [
          {
            kind: 'gas',
            process: setter.process,
            onEntering: context.names.status(setter.on),
            onlyWhen: setter.onlyWhen
          }
        ]
      : []
  }

/** A position a GAS process sets on entering `position` that the grant does not define. */
const toUndefinedTargets = (
  { setters, names }: Context,
  position: string
): UndefinedTarget[] =>
  setters.flatMap((setter) =>
    setter.kind === 'gas' &&
    setter.on === position &&
    !names.positions.has(setter.to)
      ? [{ position: setter.to, onlyWhen: setter.onlyWhen }]
      : []
  )

const toNoTrigger = (
  { lifecycle, knows }: Context,
  position: string,
  triggeredBy: TriggerRow[]
): StatusPanel['noTrigger'] => {
  if (triggeredBy.length) {
    return null
  }

  if (position === lifecycle.initialPosition) {
    return 'initial'
  }

  return knows ? 'nothing' : null
}

const toBadges = (
  { initialPosition, amendablePositions }: GrantLifecycle,
  position: string
): StatusPanel['badges'] => [
  ...(position === initialPosition ? (['initial'] as const) : []),
  ...(amendablePositions.includes(position) ? (['amendable'] as const) : [])
]

const toPanel = (
  context: Context,
  { position, phase, stage }: Place,
  links: TriggerLinks
): StatusPanel => {
  const { lifecycle, names, setters } = context
  const refOf = refFor(context, position)
  const triggeredBy = setters
    .filter(({ to }) => to === position)
    .flatMap(toTriggerRow(context, position, links))

  return {
    id: position,
    name: names.status(position),
    badges: toBadges(lifecycle, position),
    phase: names.phase(phase.code),
    stage: names.stage(`${phase.code}:${stage.code}`),
    runs: toRuns(context, position),
    undefinedTargets: toUndefinedTargets(context, position),
    waysIn: waysInto(context, position).map(toWayIn(refOf)),
    waysOut: lifecycle.waysIn
      .filter(isMove)
      .filter(({ from }) => from === position)
      .map(({ to }) => refOf(to)),
    triggeredBy,
    noTrigger: toNoTrigger(context, position, triggeredBy)
  }
}

/** Unasked, the status new applications start at. */
const toSelected = (
  positions: string[],
  asked: string | undefined,
  { initialPosition }: GrantLifecycle
): string =>
  pickPosition(
    positions,
    asked,
    positions.includes(initialPosition) ? initialPosition : positions[0]
  ) ?? ''

const toContext = (
  lifecycle: GrantLifecycle,
  hrefOf: (position: string) => string
): Context => ({
  lifecycle,
  names: toLifecycleNames(lifecycle),
  setters: toStatusSetters(lifecycle),
  knows: knowsEffects(lifecycle),
  hrefOf
})

/** The grant's statuses by phase and stage, and a panel for each; null when GAS sent neither, as for a grant not stored. */
export const toGrantPhases = (
  {
    lifecycle,
    problem
  }: { lifecycle?: GrantLifecycle | null; problem?: string | null },
  { status, href, from, workflowHref }: GrantPhasesOptions
): GrantPhasesTab | null => {
  if (typeof problem === 'string') {
    return { kind: 'unreadable', problem }
  }

  if (!lifecycle) {
    return null
  }

  const context = toContext(lifecycle, (position) =>
    toTabHref(href, 'phases', from, { status: position })
  )
  const first = firstByPosition(placesOf(lifecycle))
  const links = {
    workflowHref,
    entitlementsHref: toTabHref(href, 'entitlements', from)
  }

  return {
    kind: 'map',
    selected: toSelected([...first.keys()], status, lifecycle),
    phases: toMapPhases(context, new Set(first.values())),
    panels: [...first.values()].map((place) => toPanel(context, place, links)),
    form: toPhasesForm(href, from)
  }
}
