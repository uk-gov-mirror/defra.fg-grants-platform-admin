import { render } from '../../../test-utils.ts'

const card = (facts: object[][]) =>
  render('facts-card', { facts, label: 'Agreement', testId: 'grant' })

const valueOf = (facts: object[][], id: string) =>
  card(facts)(`[data-testid="grant-${id}"]`)

describe('facts-card component', () => {
  test('is a section named by its label, holding one list per column', () => {
    const $ = card([
      [{ id: 'code', label: 'Code', kind: 'text', text: 'WC' }],
      [{ id: 'size', label: 'Size', kind: 'text', text: '1 KiB' }]
    ])
    const section = $('[data-testid="grant-overview"]')

    expect(section.is('section')).toBe(true)
    expect(section.attr('aria-label')).toBe('Agreement')
    expect($('[data-testid="grant-facts"] > dl')).toHaveLength(2)
    expect($('[data-testid="grant-fact-code"] dt').text()).toBe('Code')
    expect($('[data-testid="grant-fact-code"] dd').text()).toBe('WC')
  })

  test('is a titled card named by its title, when given one', () => {
    const $ = render('facts-card', {
      facts: [[{ id: 'code', label: 'Code', kind: 'text', text: 'WC' }]],
      title: 'Agreement definition',
      testId: 'grant'
    })
    const section = $('[data-testid="grant-overview"]')

    expect(section.attr('aria-label')).toBeUndefined()
    expect(section.attr('aria-labelledby')).toBe('grant-facts-title')
    expect($('#grant-facts-title').text()).toBe('Agreement definition')
  })

  test('says a fact of a kind it does not draw as plain text, with no caller', () => {
    expect(
      valueOf(
        [[{ id: 'odd', label: 'Odd', kind: 'other', text: 'x' }]],
        'odd'
      ).text()
    ).toBe('x')
  })

  test('shows a mono fact in mono, with where it started', () => {
    const facts = [
      [
        {
          id: 'grant',
          label: 'Grant',
          kind: 'mono',
          text: 'woodland@1.2.0',
          from: '1.0.0'
        }
      ]
    ]

    expect(valueOf(facts, 'grant').attr('class')).toBe('text-sm')
    expect(valueOf(facts, 'grant').children().attr('class')).toBe(
      'font-mono [overflow-wrap:anywhere]'
    )
    expect(valueOf(facts, 'grant').find('wbr')).toHaveLength(0)
    expect(valueOf(facts, 'grant-from').text()).toBe('from 1.0.0')
  })

  test('shows a date as a time, and a stored empty date as quotes', () => {
    const facts = [
      [
        {
          id: 'at',
          label: 'At',
          kind: 'date',
          text: '1 May',
          instant: '2026-05-01T00:00:00.000Z'
        },
        { id: 'empty', label: 'Empty', kind: 'date', text: '', instant: null }
      ]
    ]

    expect(valueOf(facts, 'at').is('time')).toBe(true)
    expect(valueOf(facts, 'at').attr('datetime')).toBe(
      '2026-05-01T00:00:00.000Z'
    )
    expect(valueOf(facts, 'empty').text()).toBe('""')
  })

  test('opens a link in a new tab', () => {
    const facts = [
      [{ id: 'link', label: 'Link', kind: 'link', text: 'View', href: '/x' }]
    ]

    expect(valueOf(facts, 'link').attr('href')).toBe('/x')
    expect(valueOf(facts, 'link').attr('target')).toBe('_blank')
  })

  test('lists codes in mono, comma separated', () => {
    const facts = [
      [{ id: 'codes', label: 'Codes', kind: 'codes', codes: ['A', 'B'] }]
    ]
    const value = valueOf(facts, 'codes')

    expect(value.text()).toBe('A, B')
    expect(value.find('.font-mono')).toHaveLength(2)
  })

  test('shows a text fact as plain text', () => {
    const facts = [[{ id: 'none', label: 'None', kind: 'text', text: '—' }]]
    const value = valueOf(facts, 'none')

    expect(value.text()).toBe('—')
    expect(value.attr('class')).toBeUndefined()
  })
})
