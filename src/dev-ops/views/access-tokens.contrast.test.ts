import { readFileSync } from 'node:fs'
import path from 'node:path'

/** daisyUI's base-100, the dialog and drawer background: `oklch(100% 0 0)` and `oklch(25.33% 0.016 252.42)`. */
const backgrounds = { light: '#ffffff', dark: '#1d232a' }

const views = path.resolve(import.meta.dirname)

const templates = [
  'access-tokens.njk',
  'legacy/field-error/template.njk',
  'legacy/expiry-picker/template.njk'
].map((file) => readFileSync(path.join(views, file), 'utf8'))

const channel = (value: number): number => {
  const c = value / 255

  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((at) =>
    channel(parseInt(hex.slice(at, at + 2), 16))
  )

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)

  return (light + 0.05) / (dark + 0.05)
}

const firstMatch = (pattern: RegExp, text: string): string | null =>
  pattern.exec(text)?.[1] ?? null

const toColour = (classes: string) => ({
  classes,
  light: firstMatch(/(?:^|\s)text-\[(#[0-9a-f]{6})\]/, classes) ?? '',
  dark: firstMatch(
    /\[\[data-theme=dark\]_&\]:text-\[(#[0-9a-f]{6})\]/,
    classes
  ),
  darkByMedia: firstMatch(
    /\[:root:not\(\[data-theme\]\)_&\]:text-\[(#[0-9a-f]{6})\]/,
    classes
  )
})

/** Each class list that sets a hex text colour, with the shade it takes in dark mode, if any. */
const textColours = templates.flatMap((template) =>
  [...template.matchAll(/"([^"]*text-\[#[0-9a-f]{6}\][^"]*)"/g)].map(
    ([, classes]) => toColour(classes)
  )
)

/** Text drawn on a fixed light or dark panel of its own, not on the page's base colour. */
const onOwnPanel = (classes: string): boolean => /(?:^|\s)bg-\[#/.test(classes)

describe('the access token text colours', () => {
  const onBase = textColours.filter(({ classes }) => !onOwnPanel(classes))

  test('are found', () => {
    expect(onBase.map(({ light }) => light)).toEqual(
      expect.arrayContaining(['#b91c1c', '#92400e'])
    )
  })

  test.each(onBase.map((colour) => [colour.light, colour]))(
    'reach 4.5:1 for %s on the light theme',
    (_light, { light }) => {
      expect(contrast(light, backgrounds.light)).toBeGreaterThanOrEqual(4.5)
    }
  )

  test.each(onBase.map((colour) => [colour.light, colour]))(
    'take a shade for %s that reaches 4.5:1 on the dark theme, by theme toggle and by system setting alike',
    (_light, { dark, darkByMedia }) => {
      expect(dark).not.toBeNull()
      expect(darkByMedia).toBe(dark)
      expect(contrast(dark ?? '', backgrounds.dark)).toBeGreaterThanOrEqual(4.5)
    }
  )

  test('measures the design colours that failed in dark mode as failing', () => {
    expect(contrast('#b91c1c', backgrounds.dark)).toBeLessThan(4.5)
    expect(contrast('#92400e', backgrounds.dark)).toBeLessThan(4.5)
  })
})
