import { toThemeTone } from './workflow-theme.ts'

describe('toThemeTone', () => {
  test.each([
    ['NEUTRAL', 'neutral'],
    ['INFO', 'info'],
    ['NOTICE', 'warning'],
    ['WARN', 'warning'],
    ['ERROR', 'danger'],
    ['SUCCESS', 'success']
  ])("draws CW's %s theme as %s", (theme, tone) => {
    expect(toThemeTone(theme)).toBe(tone)
  })

  test.each(['NONE', 'PURPLE', ''])('draws %j as neutral', (theme) => {
    expect(toThemeTone(theme)).toBe('neutral')
  })
})
