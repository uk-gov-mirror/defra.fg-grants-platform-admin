import { render } from '../../../test-utils.ts'
import { toJsonView } from '../../../view-models/json-viewer.view-model.ts'

const viewer = (value: unknown, label = 'Payload') =>
  render('json-viewer', {
    view: toJsonView(value),
    label,
    testId: 'payload'
  })

describe('json-viewer component', () => {
  test('nests a details for each object or array that spans lines', () => {
    const $ = viewer({ a: { b: [1, 2] }, c: [] })

    expect($('[data-testid="payload"] > details')).toHaveLength(1)
    expect($('details details details')).toHaveLength(1)
    expect($('details')).toHaveLength(3)
  })

  test('puts the opening line in the summary, so a click on it folds the node', () => {
    const $ = viewer({ a: { b: 1 } })
    const summary = $('details details > summary')

    expect(summary.find('[data-testid="payload-line"] code').text()).toBe(
      '  "a": {'
    )
    expect(summary.find('[data-line]').attr('data-line')).toBe('2')
  })

  test('says what a folded node holds, and closes it, on the summary line', () => {
    const $ = viewer({ a: Array.from({ length: 13 }, (_, i) => i), b: 1 })
    const fold = $('details details')

    expect(fold.attr('open')).toBeUndefined()
    expect(
      fold
        .children('summary')
        .find('[data-testid="payload-folded"]')
        .text()
        .replace(/\s+/g, ' ')
        .trim()
    ).toBe('13 items ],')
  })

  test('keeps a fold on the same line height as every other row', () => {
    const $ = viewer({ a: { b: 1 } })
    const summary = $('summary').first()

    expect(summary.attr('class')).not.toContain('min-h-')
    expect(summary.children().last().prev().attr('class')).toContain(
      'h-[1lh] w-3 items-center justify-end leading-none'
    )
  })

  test('floats Copy in the top right corner of the block, clear of its scrollbar', () => {
    const $ = viewer({ a: 1 })

    expect($('[data-json-viewer-tools]').attr('class')).toBe(
      'absolute top-2 right-5 z-1'
    )
    expect($('do-json-viewer').attr('class')).toBe('relative flex flex-col')
  })

  test('keeps numbers out of the selectable text', () => {
    const $ = viewer({ a: 1 })
    const number = $('[data-testid="payload-line"] [data-line]').first()

    expect(number.text()).toBe('')
    expect(number.attr('aria-hidden')).toBe('true')
    expect($('[data-testid="payload"]').attr('class')).toContain(
      '[&_[data-line]]:before:content-[attr(data-line)]'
    )
  })

  test('is a named region a keyboard can reach', () => {
    const region = viewer(
      { a: 1 },
      'Payload before the first edit'
    )('[data-testid="payload"]')

    expect(region.attr('role')).toBe('region')
    expect(region.attr('tabindex')).toBe('0')
    expect(region.attr('aria-label')).toBe('Payload before the first edit')
  })

  test('draws markup in a key or a value as text', () => {
    const $ = viewer({ '<b>key</b>': '<script>alert(1)</script>' })

    expect($('script')).toHaveLength(0)
    expect($('b')).toHaveLength(0)
    expect($('[data-testid="payload-line"] code').eq(1).text()).toBe(
      '  "<b>key</b>": "<script>alert(1)</script>"'
    )
  })

  test('hides Copy until script shows it, and names what it copies', () => {
    const $ = viewer({ a: 1 })
    const copy = $('[data-testid="payload-copy"]')

    expect(copy.parent().attr('hidden')).toBeDefined()
    expect(copy.text()).toBe('Copy payload')
  })
})
