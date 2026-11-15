import { render } from '../../../test-utils.ts'

describe('icon component', () => {
  test('renders the alert warning icon as a stroked inline svg', () => {
    const $icon = render('icon', {
      name: 'exclamation-triangle',
      class: 'h-4 w-4 shrink-0'
    })

    const svg = $icon('[data-testid="do-icon-exclamation-triangle"]')

    expect(svg).toHaveLength(1)
    expect(svg.attr('class')).toBe('h-4 w-4 shrink-0')
    expect(svg.attr('aria-hidden')).toBe('true')
    expect(svg.attr('stroke')).toBe('currentColor')
    expect(svg.find('path')).toHaveLength(1)
  })

  test('renders the alert error icon as a stroked inline svg', () => {
    const $icon = render('icon', {
      name: 'exclamation-circle',
      class: 'h-4 w-4 shrink-0'
    })

    const svg = $icon('[data-testid="do-icon-exclamation-circle"]')

    expect(svg).toHaveLength(1)
    expect(svg.attr('stroke')).toBe('currentColor')
    expect(svg.find('circle')).toHaveLength(1)
    expect(svg.find('path')).toHaveLength(1)
  })

  test('escapes hostile classes rather than emitting them', () => {
    const $icon = render('icon', { name: 'info', class: '"><script>' })

    expect($icon('script')).toHaveLength(0)
  })

  test('omits the class attribute when no classes are given', () => {
    const $icon = render('icon', { name: 'info' })

    expect($icon('[data-testid="do-icon-info"]').attr('class')).toBeUndefined()
  })

  test.each([
    ['folder', 1],
    ['workflow', 1],
    ['info', 2]
  ])('renders the icon %s as a stroked lucide svg', (name, paths) => {
    const svg = render('icon', { name, class: 'size-4' })(
      `[data-testid="do-icon-${name}"]`
    )

    expect(svg.attr('stroke')).toBe('currentColor')
    expect(svg.attr('aria-hidden')).toBe('true')
    expect(svg.find('path')).toHaveLength(paths)
  })

  test('throws for a name the set does not hold', () => {
    expect(() => render('icon', { name: 'unicorn' })).toThrow(
      'template not found'
    )
  })
})
