import { environment } from '../../../view-options.ts'

describe('muted', () => {
  test('is the one muted text colour', () => {
    expect(
      environment.renderString(
        '{% from "muted/macro.njk" import muted %}{{ muted }}',
        {}
      )
    ).toBe('text-base-content/70')
  })
})
