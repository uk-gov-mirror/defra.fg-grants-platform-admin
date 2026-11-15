import type { PositionNames } from '../use-cases/read-position-names.use-case.ts'
import type { Position } from '../use-cases/record-reads.ts'
import { toHumanCode } from './position.ts'

export interface WhereFact {
  label: string
  /** Null draws the sign for a missing value. */
  text: string | null
}

/** Where a record is: its phases as steps and its stage, or, without the phases to place it in, the bare facts. */
export type Where =
  | {
      kind: 'stepper'
      steps: { label: string }[]
      current: number
      stage: string | null
    }
  | { kind: 'facts'; facts: WhereFact[] }

type Phase = PositionNames['phases'][number]
type Stage = Phase['stages'][number]

const nameOr = (
  named: { name?: string | null } | undefined,
  code: string
): string => named?.name ?? toHumanCode(code)

const findPhase = (names: PositionNames | null, code: string | null) =>
  names?.phases.find((phase) => phase.code === code)

const findStage = (phase: Phase | undefined, code: string | null) =>
  phase?.stages.find((stage) => stage.code === code)

const findStatus = (stage: Stage | undefined, code: string | null) =>
  stage?.statuses.find((status) => status.code === code)

const phaseName = (position: Position, names: PositionNames | null) =>
  position.phase === null
    ? null
    : nameOr(findPhase(names, position.phase), position.phase)

const stageName = (position: Position, names: PositionNames | null) =>
  position.stage === null
    ? null
    : nameOr(
        findStage(findPhase(names, position.phase), position.stage),
        position.stage
      )

/** The status as its definition names it, else its code made readable; null where the record has none. */
export const toStatusName = (
  position: Position,
  names: PositionNames | null
): string | null =>
  position.status === null
    ? null
    : nameOr(
        findStatus(
          findStage(findPhase(names, position.phase), position.stage),
          position.status
        ),
        position.status
      )

export const isEmptyPosition = ({ phase, stage, status }: Position): boolean =>
  phase === null && stage === null && status === null

/** The phase is the stepper's current step and the status is in the header, so only the stage is added. */
export const toWhere = (
  position: Position,
  names: PositionNames | null
): Where => {
  const at = names
    ? names.phases.findIndex((phase) => phase.code === position.phase)
    : -1

  return names && at >= 0
    ? {
        kind: 'stepper',
        steps: names.phases.map((phase) => ({
          label: nameOr(phase, phase.code)
        })),
        current: at,
        stage: stageName(position, names)
      }
    : {
        kind: 'facts',
        facts: [
          { label: 'Phase', text: phaseName(position, names) },
          { label: 'Stage', text: stageName(position, names) }
        ]
      }
}

/** A case CW sent nothing for: phase, stage and status, each not set. */
export const noPositionFacts: WhereFact[] = [
  { label: 'Phase', text: null },
  { label: 'Stage', text: null },
  { label: 'Status', text: null }
]
