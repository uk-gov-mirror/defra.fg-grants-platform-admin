import { toSidebarSections, toTitleCase } from './shell.ts'

const item = (id: string, icon: string, ids = [id], perService = false) => ({
  id,
  ids,
  label: id,
  perService,
  href: `/dev-ops/${id}`,
  icon
})

describe('toSidebarSections', () => {
  test('names each service in full and draws its pages with their icons', () => {
    expect(
      toSidebarSections(
        [
          {
            title: 'GAS',
            items: [item('gas.outbox', 'activity', ['gas.outbox', 'gas.inbox'])]
          },
          { title: 'CW', items: [item('cw.cases', 'folder')] }
        ],
        'gas.inbox'
      )
    ).toEqual([
      {
        title: 'Grant Application Service',
        items: [
          {
            id: 'gas.outbox',
            text: 'gas.outbox',
            href: '/dev-ops/gas.outbox',
            icon: 'radio-tower',
            current: true,
            testId: 'shell-nav-gas.outbox'
          }
        ]
      },
      {
        title: 'Caseworking',
        items: [
          {
            id: 'cw.cases',
            text: 'cw.cases',
            href: '/dev-ops/cw.cases',
            icon: 'briefcase',
            current: false,
            testId: 'shell-nav-cw.cases'
          }
        ]
      }
    ])
  })

  test('keeps a list it does not map under the catalogue’s own name and icon', () => {
    const [section] = toSidebarSections(
      [{ title: 'PAYMENTS', items: [item('pay.runs', 'banknote')] }],
      null
    )

    expect(section.title).toBe('PAYMENTS')
    expect(section.items[0].icon).toBe('banknote')
  })

  test('draws a folder for an icon the icon set has not got, rather than failing the page', () => {
    const [section] = toSidebarSections(
      [{ title: 'GAS', items: [item('gas.other', 'no-such-icon')] }],
      null
    )

    expect(section.items[0].icon).toBe('folder')
  })

  test('marks nothing current on a page under no list', () => {
    const [section] = toSidebarSections(
      [{ title: 'GAS', items: [item('gas.grants', 'scroll-text')] }],
      undefined
    )

    expect(section.items[0].current).toBe(false)
  })
})

describe('toSidebarSections srPrefix', () => {
  const sections = [
    {
      title: 'GAS',
      items: [
        { ...item('gas.outbox', 'activity', undefined, true), label: 'Events' },
        { ...item('gas.applications', 'file-text'), label: 'Applications' },
        {
          ...item('clients-gas', 'key', undefined, true),
          label: 'Access tokens'
        }
      ]
    },
    {
      title: 'CW',
      items: [
        { ...item('cw.outbox', 'activity', undefined, true), label: 'Outbox' },
        { ...item('cw.cases', 'folder'), label: 'Cases' },
        {
          ...item('clients-cw', 'key', undefined, true),
          label: 'Access tokens'
        }
      ]
    }
  ]
  const prefixes = (drawn: ReturnType<typeof toSidebarSections>) =>
    drawn.flatMap(({ items }) =>
      items.map(({ id, srPrefix }) => [id, srPrefix])
    )

  test('gives each service’s events and access tokens their service, whatever their link says, as the prototype does', () => {
    expect(prefixes(toSidebarSections(sections, null))).toEqual([
      ['gas.outbox', 'Grant Application Service'],
      ['gas.applications', undefined],
      ['clients-gas', 'Grant Application Service'],
      ['cw.outbox', 'Caseworking'],
      ['cw.cases', undefined],
      ['clients-cw', 'Caseworking']
    ])
  })

  test('still gives Events its service while Caseworking lists none', () => {
    expect(prefixes(toSidebarSections([sections[0]], null))).toEqual([
      ['gas.outbox', 'Grant Application Service'],
      ['gas.applications', undefined],
      ['clients-gas', 'Grant Application Service']
    ])
  })
})

describe('toTitleCase', () => {
  test.each([
    ['ada lovelace', 'Ada Lovelace'],
    ['ADA LOVELACE', 'Ada Lovelace'],
    ['ada lovelace-king', 'Ada Lovelace-King'],
    ["siobhan o'neill", "Siobhan O'Neill"],
    ['Ian McDonald', 'Ian McDonald'],
    ['ada.lovelace@example.gov.uk', 'ada.lovelace@example.gov.uk']
  ])('writes %s as %s', (name, cased) => {
    expect(toTitleCase(name)).toBe(cased)
  })
})
