import { render } from '../../../test-utils.ts'
import { toGrantQuestions } from '../../../view-models/grant-questions.ts'
import type { SchemaTreeRow } from '../../../view-models/grant-questions.ts'

const rowsOf = (questions: object): SchemaTreeRow[] => {
  const tab = toGrantQuestions({ phases: [{ code: 'PRE_AWARD', questions }] })
  const [card] = tab.kind === 'cards' ? tab.cards : []

  return card?.kind === 'schema' ? card.rows : []
}

const tree = (questions: object, checked = true) =>
  render('schema-tree', { rows: rowsOf(questions), checked, testId: 'tree' })

const nested = {
  required: ['applicant'],
  properties: {
    applicant: {
      type: 'object',
      title: 'Applicant details',
      properties: {
        business: {
          type: 'object',
          properties: { name: { type: 'string', maxLength: 100 } }
        }
      }
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { species: { type: 'string', enum: ['oak', 'birch'] } }
      }
    },
    planned: { type: 'boolean', default: false }
  }
}

describe('schema-tree component', () => {
  test('nests an open details for each object and each array of objects', () => {
    const $ = tree(nested)

    expect($('details')).toHaveLength(3)
    expect($('details:not([open])')).toHaveLength(0)
    expect($('details details')).toHaveLength(1)
    expect($('details details > div [data-testid="tree-name"]').text()).toBe(
      'name'
    )
  })

  test('puts the chevron in the summary, turned only by its own details', () => {
    const $ = tree(nested)
    const summary = $('details > summary').first()

    expect(summary.find('[data-testid="tree-name"]').text()).toBe('applicant')
    expect(summary.find('svg').attr('class')).toContain(
      '[details[open]>summary_&]:rotate-0'
    )
    expect($('[data-testid="tree-fold"]')).toHaveLength(3)
  })

  test('indents each level with a class from the literal map', () => {
    const $ = tree(nested)
    const indentOf = (index: number) =>
      $('[data-testid="tree-row"]')
        .eq(index)
        .children()
        .first()
        .attr('class')
        ?.split(' ')
        .find((name) => name.startsWith('pl-'))

    expect([0, 1, 2, 3, 4].map(indentOf)).toEqual([
      'pl-0',
      'pl-5',
      'pl-10',
      'pl-0',
      'pl-5'
    ])
  })

  test('sets no inline style, which the CSP would block', () => {
    expect(tree(nested)('[style]')).toHaveLength(0)
  })

  test('shows the column heads from sm up only', () => {
    const head = tree(nested)('[data-testid="tree-head"]')

    expect(head.attr('class')?.split(' ')).toEqual(
      expect.arrayContaining(['hidden', 'sm:grid'])
    )
    expect(
      head
        .children()
        .toArray()
        .map((cell) => head.find(cell).text())
    ).toEqual(['Property', 'Type', 'Required', 'Constraints'])
  })

  test('hides the column heads from assistive technology, which has no table to read them in', () => {
    const $ = tree(nested)

    expect($('[data-testid="tree-head"]').attr('aria-hidden')).toBe('true')
    expect($('[role]')).toHaveLength(0)
  })

  test('labels the type and the constraints in each row for assistive technology', () => {
    const $ = tree(nested)
    const row = $('[data-testid="tree-row"]').eq(2)
    const hidden = row.find('.sr-only')

    expect(hidden.toArray().map((label) => $(label).text())).toEqual([
      'Type: ',
      'Constraints: '
    ])
    expect(hidden.eq(0).next().is('[data-testid="tree-type"]')).toBe(true)
    expect(hidden.eq(1).next().is('[data-testid="tree-constraints"]')).toBe(
      true
    )
    expect(row.text().replace(/\s+/g, ' ').trim()).toBe(
      'name Type: string Optional Constraints: length ≤ 100'
    )
  })

  test('says Required in words only, and Optional muted', () => {
    const $ = tree(nested)
    const row = $('[data-testid="tree-row"]').first()

    expect(row.find('.text-error')).toHaveLength(0)
    expect(row.text()).not.toContain('*')
    expect(row.find('[data-testid="tree-required"]').text()).toBe('Required')
    expect(
      $('[data-testid="tree-required"]').eq(1).children().attr('class')
    ).toBe('text-base-content/70')
  })

  test('shows the type, the title, the constraints and the default', () => {
    const $ = tree(nested)
    const rows = $('[data-testid="tree-row"]')
    const flatten = (index: number, part: string) =>
      rows
        .eq(index)
        .find(`[data-testid="tree-${part}"]`)
        .text()
        .replace(/\s+/g, ' ')
        .trim()

    expect(flatten(0, 'name')).toBe('applicant')
    expect(rows.eq(0).text()).toContain('Applicant details')
    expect(flatten(2, 'constraints')).toBe('length ≤ 100')
    expect(flatten(3, 'name')).toBe('items[]')
    expect(flatten(3, 'type')).toBe('array of object')
    expect(flatten(4, 'constraints')).toBe('one of oak, birch')
    expect(flatten(5, 'constraints')).toBe('default false')
    expect(flatten(0, 'constraints')).toBe('—')
    expect(
      rows.eq(4).find('[data-testid="tree-constraint"] .font-mono')
    ).toHaveLength(2)
    expect(rows.eq(5).find('[data-testid="tree-default"]').attr('title')).toBe(
      'Filled in when missing'
    )
  })

  test('says only what GAS would do on a phase it does not check', () => {
    const $ = tree(
      {
        properties: {
          a: { type: 'object', properties: {}, additionalProperties: false },
          b: { type: 'string', default: 'x' }
        }
      },
      false
    )

    expect($('[data-testid="tree-closed"]').attr('title')).toBe(
      'Fields not listed under it would be removed on submission'
    )
    expect($('[data-testid="tree-default"]').attr('title')).toBe(
      'Would be filled in when missing'
    )
  })

  test('badges a closed object, says where a ref came from, and clamps a description to a line', () => {
    const $ = tree({
      $defs: {
        address: {
          type: 'object',
          description: 'A made-up address.',
          properties: { line1: { type: 'string' } },
          additionalProperties: false
        }
      },
      properties: { address: { $ref: '#/$defs/address' } }
    })

    expect($('[data-testid="tree-closed"]').text()).toBe('closed')
    expect($('[data-testid="tree-closed"]').attr('class')).toBe(
      'badge badge-ghost badge-sm'
    )
    expect($('[data-testid="tree-from"]').text()).toBe('from $defs/address')
    expect($('[data-testid="tree-from"] .font-mono')).toHaveLength(1)
    expect($('[data-testid="tree-description"]').attr('class')).toContain(
      'truncate'
    )
    expect($('[data-testid="tree-description"]').attr('title')).toBe(
      'A made-up address.'
    )
  })

  test('heads each conditional group of rows with its condition, codes in mono', () => {
    const $ = tree({
      properties: { flag: { type: 'boolean' }, ref: { type: 'string' } },
      if: { properties: { flag: { const: true } } },
      then: { required: ['ref'] }
    })
    const group = $('[data-testid="tree-group"]')

    expect(group.text()).toBe('If flag is absent or = true')
    expect(group.find('.font-mono').text()).toBe('flag')
    expect(group.attr('class')).toContain('pl-0')
    expect($('[data-testid="tree-row"]').last().attr('class')).toContain(
      'items-start'
    )
  })

  test('escapes markup in a name, a title or a pattern', () => {
    const $ = tree({
      properties: {
        '<b>x</b>': { title: '<i>t</i>', pattern: '<script>' }
      }
    })

    expect($('b, i, script')).toHaveLength(0)
    expect($('[data-testid="tree-name"]').text()).toBe('<b>x</b>')
    expect($('[data-testid="tree-constraints"]').text()).toContain(
      'pattern <script>'
    )
  })
})
