import type { Position } from '../use-cases/record-reads.ts'

export interface PositionStep {
  label: string
  current: boolean
}

/** `STATUS_OFFER_ACCEPTED` reads "Offer accepted"; the exact codes are left to Raw. */
export const toHumanCode = (code: string): string => {
  const words = code
    .replace(/^(PHASE|STAGE|STATUS)_/, '')
    .toLowerCase()
    .replaceAll('_', ' ')

  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Phase › stage › status, leaving out any step the record has not got, the status last. */
export const toPositionTrail = ({
  phase,
  stage,
  status
}: Position): PositionStep[] =>
  [phase, stage, status].flatMap((code, index) =>
    code === null ? [] : [{ label: toHumanCode(code), current: index === 2 }]
  )

/** The whole trail in one line, for a title or a screen reader. */
export const toPositionLabel = (position: Position): string =>
  toPositionTrail(position)
    .map(({ label }) => label)
    .join(' › ')
