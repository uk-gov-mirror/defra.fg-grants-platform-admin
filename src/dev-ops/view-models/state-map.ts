/** A status as the Phases tab's map draws it: one per position, by name. */
export interface MapState {
  id: string
  label: string
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger'
  kind?: 'process' | 'move'
  badge?: string
  icon?: string
  iconLabel?: string
  iconTone?: 'warning'
}

export interface MapStage {
  id: string
  label: string
  states: MapState[]
}

export interface MapPhase {
  id: string
  label: string
  stages: MapStage[]
}

/** The form a pick submits without a script: this tab, with `status` set to the pick. */
export interface PhasesForm {
  id: string
  action: string
  hidden: { name: string; value: string }[]
}

export const toPhasesForm = (href: string, from: string): PhasesForm => ({
  id: 'phases-pick',
  action: href,
  hidden: [
    { name: 'tab', value: 'phases' },
    ...(from ? [{ name: 'back', value: from }] : [])
  ]
})

/** The first copy of each position, as GAS and CW both take it. */
export const firstByPosition = <T extends { position: string }>(
  items: T[]
): Map<string, T> =>
  items.reduce(
    (first, item) =>
      first.has(item.position) ? first : first.set(item.position, item),
    new Map<string, T>()
  )

const bareMatch = (positions: string[], asked: string | undefined) =>
  asked && !asked.includes(':')
    ? positions.find((position) => position.endsWith(`:${asked}`))
    : undefined

/** `PHASE:STAGE` selects the stage's first status. */
const stageMatch = (positions: string[], asked: string | undefined) =>
  asked?.split(':').length === 2
    ? positions.find((position) => position.startsWith(`${asked}:`))
    : undefined

/** `asked` is the `status` query value: a full position, a bare status code or a stage; anything else picks `fallback`. */
export const pickPosition = (
  positions: string[],
  asked: string | undefined,
  fallback: string | undefined
): string | undefined =>
  positions.find((position) => position === asked) ??
  bareMatch(positions, asked) ??
  stageMatch(positions, asked) ??
  fallback
