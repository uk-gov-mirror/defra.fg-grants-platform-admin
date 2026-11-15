import type {
  StoredInput,
  StoredLabel,
  StoredTask,
  StoredTransition,
  StoredWorkflowPhase,
  StoredWorkflowStage
} from '../use-cases/get-workflow-page.use-case.ts'
import { checksTasks } from './workflow-transitions.ts'

export interface TaskRow {
  name: string
  mandatory: boolean
  /** The answers a caseworker can give: each option's name, or the input's type and label. */
  answers: string[]
}

export interface TaskGroupCard {
  /** On a stage's first card only, so a link to the stage lands on it. */
  anchor: string | null
  name: string
  stageName: string
  /** The moves CW refuses while a mandatory task here is open; empty when none. */
  completesWith: string[]
  tasks: TaskRow[]
}

const toLabel = (label: StoredLabel): string =>
  typeof label === 'string' ? label : label.text

const toInputAnswer = ({ type, label }: StoredInput): string =>
  `${type[0].toUpperCase()}${type.slice(1)}: ${toLabel(label)}`

const toAnswers = (task: StoredTask): string[] =>
  task.input
    ? [toInputAnswer(task.input)]
    : task.valueOptions.map(({ name }) => name)

const toTaskRow = (task: StoredTask): TaskRow => ({
  name: task.name,
  mandatory: task.mandatory,
  answers: toAnswers(task)
})

type StatusNames = Map<string, string>

const toStatusNames = (phases: StoredWorkflowPhase[]): StatusNames =>
  new Map(
    phases.flatMap(({ code: phase, stages }) =>
      stages.flatMap(({ code: stage, statuses }) =>
        statuses.map(({ code, name }): [string, string] => [
          `${phase}:${stage}:${code}`,
          name
        ])
      )
    )
  )

/** A caseworker's action by its name; a move GAS sends by the status it moves to. */
const toGate =
  (names: StatusNames) =>
  ({ action, targetPosition }: StoredTransition): string =>
    action
      ? action.name
      : `GAS move to ${names.get(targetPosition) ?? targetPosition}`

/** The stage's moves that CW refuses while its mandatory tasks are open, each once. */
const toStageGates = (
  { statuses }: StoredWorkflowStage,
  names: StatusNames
): string[] => [
  ...new Set(
    statuses
      .flatMap(({ transitions }) => transitions)
      .filter(checksTasks)
      .map(toGate(names))
  )
]

/** A stage's place on the Tasks tab: stage codes are unique only within their phase, and either may hold a hyphen. Encoded, so it is also its own URL fragment. */
export const toStageAnchor = (phase: string, stage: string): string =>
  `stage-${encodeURIComponent(phase)}:${encodeURIComponent(stage)}`

const toCards = (
  phase: string,
  stage: StoredWorkflowStage,
  names: StatusNames
): TaskGroupCard[] => {
  const gates = toStageGates(stage, names)

  return stage.taskGroups.map(({ name, tasks }, index) => ({
    anchor: index === 0 ? toStageAnchor(phase, stage.code) : null,
    name,
    stageName: stage.name,
    completesWith: tasks.some(({ mandatory }) => mandatory) ? gates : [],
    tasks: tasks.map(toTaskRow)
  }))
}

/** Every task group of the workflow, in definition order. */
export const toTaskGroups = (
  phases: StoredWorkflowPhase[]
): TaskGroupCard[] => {
  const names = toStatusNames(phases)

  return phases.flatMap(({ code, stages }) =>
    stages.flatMap((stage) => toCards(code, stage, names))
  )
}
