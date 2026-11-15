// @vitest-environment happy-dom

import { holdPageGutter } from './page-gutter.ts'

const root = document.documentElement

const pageWidth = (width: number) =>
  vi
    .spyOn(root, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, width, 0))

describe('holdPageGutter', () => {
  beforeEach(() => {
    root.style.removeProperty('--page-gutter')
    root.style.removeProperty('scrollbar-gutter')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("keeps the width the page's scrollbar gutter takes", () => {
    pageWidth(window.innerWidth - 15)

    holdPageGutter()

    expect(root.style.getPropertyValue('--page-gutter')).toBe('15px')
  })

  test('keeps the measure it has once a drawer or dialog has taken the gutter', () => {
    pageWidth(window.innerWidth - 15)
    holdPageGutter()
    root.style.setProperty('scrollbar-gutter', 'auto')
    pageWidth(window.innerWidth)

    holdPageGutter()

    expect(root.style.getPropertyValue('--page-gutter')).toBe('15px')
  })
})
