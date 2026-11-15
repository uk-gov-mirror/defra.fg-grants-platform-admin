/** How CW colours a status, as the status tones say it. */
export type ThemeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

const themeTones = new Map<string, ThemeTone>([
  ['NEUTRAL', 'neutral'],
  ['INFO', 'info'],
  ['NOTICE', 'warning'],
  ['WARN', 'warning'],
  ['ERROR', 'danger'],
  ['SUCCESS', 'success']
])

/** A CW theme as a tone; `NONE`, or any theme CW does not draw, is neutral. */
export const toThemeTone = (theme: string): ThemeTone =>
  themeTones.get(theme) ?? 'neutral'
