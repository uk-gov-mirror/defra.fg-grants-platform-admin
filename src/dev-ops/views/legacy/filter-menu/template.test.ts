import { render } from '../../../test-utils.ts'

const choice = {
  testId: 'bucket-search-kind',
  panelId: 'bucket-search-kind-panel',
  field: 'ref-kind',
  label: 'Search events by',
  items: [
    { value: 'ref', label: 'Reference', active: false },
    { value: 'msg', label: 'Message id', active: true }
  ]
}

const part = ($: ReturnType<typeof render>, name: string) =>
  $(`[data-testid="bucket-search-kind-${name}"]`)

describe('filter-menu component as a form choice', () => {
  test('works without script: the select is the field, the menu waits', () => {
    const $menu = render('filter-menu', choice)

    const select = part($menu, 'select')

    expect(select.attr('name')).toBe('ref-kind')
    expect(select.attr('aria-label')).toBe('Search events by')
    expect(
      select
        .find('option')
        .toArray()
        .map((option) => [$menu(option).attr('value'), $menu(option).text()])
    ).toEqual([
      ['ref', 'Reference'],
      ['msg', 'Message id']
    ])
    expect(select.find('option[selected]').attr('value')).toBe('msg')
    expect(part($menu, 'value').attr('disabled')).toBeDefined()
    expect(part($menu, 'button').attr('hidden')).toBeDefined()
  })

  test('carries the choice in a hidden input of the same name', () => {
    const $menu = render('filter-menu', choice)

    const value = part($menu, 'value')

    expect(value.attr('type')).toBe('hidden')
    expect(value.attr('name')).toBe('ref-kind')
    expect(value.attr('value')).toBe('msg')
  })

  test('names the button for what it chooses and shows the choice', () => {
    const $menu = render('filter-menu', choice)

    const button = part($menu, 'button')

    expect(button.attr('type')).toBe('button')
    expect(button.attr('popovertarget')).toBe('bucket-search-kind-panel')
    expect(button.text().replace(/\s+/g, ' ').trim()).toBe(
      'Search events by: Message id'
    )
    expect(part($menu, 'panel').attr('aria-label')).toBe('Search events by')
  })

  test('offers each option as a button that submits nothing, marking the chosen one', () => {
    const $menu = render('filter-menu', choice)

    const options = part($menu, 'chip').toArray()

    expect(
      options.map((option) => [
        $menu(option).attr('type'),
        $menu(option).attr('data-value'),
        $menu(option).attr('aria-pressed'),
        $menu(option).text().trim()
      ])
    ).toEqual([
      ['button', 'ref', 'false', 'Reference'],
      ['button', 'msg', 'true', 'Message id']
    ])
  })

  test('starts on the first option when none is chosen', () => {
    const $menu = render('filter-menu', {
      ...choice,
      items: choice.items.map((item) => ({ ...item, active: false }))
    })

    expect(part($menu, 'value').attr('value')).toBe('ref')
    expect(part($menu, 'chosen').text()).toBe('Reference')
  })

  test('opens a menu at least 250px wide', () => {
    const $menu = render('filter-menu', choice)

    expect(part($menu, 'panel').hasClass('min-w-[250px]')).toBe(true)
  })
})

const links = {
  testId: 'grant-switcher',
  panelId: 'grant-switcher-panel',
  name: 'Version',
  label: 'Versions of woodland-creation',
  items: [
    { label: '2.0.0', href: '/dev-ops/grants/w/2.0.0', active: false },
    { label: '1.2.0', href: '/dev-ops/grants/w/1.2.0', active: true }
  ]
}

const switcherPart = ($: ReturnType<typeof render>, name: string) =>
  $(`[data-testid="grant-switcher-${name}"]`)

describe('filter-menu component as links', () => {
  test('draws a full-size trigger, with nothing beside each label, unless asked', () => {
    const $menu = render('filter-menu', links)

    expect(switcherPart($menu, 'button').hasClass('btn-sm')).toBe(false)
    expect($menu('[data-testid="do-status-badge"]')).toHaveLength(0)
    expect(
      switcherPart($menu, 'chip')
        .toArray()
        .map((chip) => $menu(chip).text().trim())
    ).toEqual(['2.0.0', '1.2.0'])
  })

  test('leaves its links in the tab order, for a page without script', () => {
    const $menu = render('filter-menu', links)

    expect(switcherPart($menu, 'chip').filter('[tabindex]')).toHaveLength(0)
  })

  test('draws a small plain trigger when asked, naming the open item', () => {
    const $menu = render('filter-menu', { ...links, small: true })
    const button = switcherPart($menu, 'button')

    expect(button.hasClass('btn-sm')).toBe(true)
    expect(button.hasClass('font-semibold')).toBe(false)
    expect(button.text().replace(/\s+/g, ' ').trim()).toBe('Version: 1.2.0')
    expect(switcherPart($menu, 'panel').attr('aria-label')).toBe(
      'Versions of woodland-creation'
    )
  })

  test('gives each item its status and, muted on the right, what is set aside', () => {
    const $menu = render('filter-menu', {
      ...links,
      items: links.items.map((item) => ({
        ...item,
        status: { status: 'Active', role: 'success' },
        aside: '10 Oct 17:25'
      }))
    })
    const chip = switcherPart($menu, 'chip').last()

    expect(chip.attr('aria-current')).toBe('page')
    expect(chip.find('[data-testid="do-status-label"]').text()).toBe('Active')
    expect(
      chip.find('[data-testid="do-status-dot"]').hasClass('status-success')
    ).toBe(true)
    expect(switcherPart($menu, 'aside').last().text()).toBe('10 Oct 17:25')
    expect(switcherPart($menu, 'aside').last().attr('class')).toBe(
      'ml-auto pl-4 text-base-content/70'
    )
  })
})
