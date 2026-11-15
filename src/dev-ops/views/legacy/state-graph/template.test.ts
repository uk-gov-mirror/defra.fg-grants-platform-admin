import { render } from '../../../test-utils.ts'
import { toStateGraphs } from '../../../view-models/state-graph.view-model.ts'
import type { StateMap } from '../../../view-models/state-graph.view-model.ts'

const map: StateMap = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: 'Pre-award',
      stages: [
        {
          code: 'REVIEW',
          name: 'Review application',
          statuses: [
            {
              code: 'IN_REVIEW',
              name: 'In review',
              tone: 'info',
              flagged: false,
              chip: 'start'
            },
            {
              code: 'ON_HOLD',
              name: 'On hold',
              tone: 'neutral',
              flagged: true,
              findings: ['dead end']
            },
            {
              code: 'APPROVED',
              name: 'Approved',
              tone: null,
              flagged: false,
              chip: 'any status'
            }
          ]
        }
      ]
    },
    {
      code: 'POST_AWARD',
      name: null,
      stages: [
        {
          code: 'AGREEMENT',
          name: null,
          statuses: [
            { code: 'OFFERED', name: 'Offered', tone: null, flagged: false }
          ]
        }
      ]
    }
  ],
  moves: [
    {
      from: 'PRE_AWARD:REVIEW:IN_REVIEW',
      to: 'PRE_AWARD:REVIEW:ON_HOLD',
      kind: 'plain',
      title: 'Put on hold (PUT_ON_HOLD)'
    },
    {
      from: 'PRE_AWARD:REVIEW:IN_REVIEW',
      to: 'PRE_AWARD:REVIEW:APPROVED',
      kind: 'strong',
      title: 'IN_REVIEW → APPROVED: GENERATE_AGREEMENT'
    },
    {
      from: 'PRE_AWARD:REVIEW:APPROVED',
      to: 'POST_AWARD:AGREEMENT:OFFERED',
      kind: 'dashed',
      title: 'GAS sends'
    }
  ]
}

const legend = [
  { kind: 'strong', label: 'Runs a GAS process on the move' },
  { kind: 'dashed', label: 'GAS may send' },
  { kind: 'other-phase', label: 'Other phase' }
]

interface Options {
  map: StateMap
  asked?: string
  legend: object[]
}

const graph = (
  overrides: Partial<Options> = {},
  block = '<p data-testid="body">Panel body</p>'
) => {
  const options: Options = { map, legend, ...overrides }

  return render(
    'state-graph',
    {
      graphs: toStateGraphs(
        options.map,
        options.asked,
        (position) => `/dev-ops/x?tab=phases&status=${position}`
      ),
      legend: options.legend,
      testId: 'phases'
    },
    block
  )
}

const node = ($: ReturnType<typeof graph>, position: string) =>
  $(`[data-testid="phases-node"][data-position="${position}"]`)

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

describe('state-graph component', () => {
  test('draws one card per phase, titled with its name then its code muted, and an id to link to', () => {
    const $ = graph()
    const cards = $('[data-testid="phases-phase"]')

    expect(cards.map((_, card) => $(card).attr('data-phase')).get()).toEqual([
      'PRE_AWARD',
      'POST_AWARD'
    ])
    expect(cards.first().attr('id')).toBe('phase-PRE_AWARD')
    expect(flatten(cards.first().find('h2').text())).toBe('Pre-award PRE_AWARD')
    expect(cards.first().find('h2 [data-name]').text()).toBe('Pre-award')
    expect(cards.first().find('h2').attr('class')).toContain('break-words')
    expect(flatten(cards.last().find('h2').text())).toBe('POST_AWARD')
  })

  test('puts the legend in the first card only, beside its title', () => {
    const $ = graph()
    const cards = $('[data-testid="phases-phase"]')

    expect(cards.first().find('[data-testid="phases-legend"]')).toHaveLength(1)
    expect(cards.last().find('[data-testid="phases-legend"]')).toHaveLength(0)
    expect(
      cards.first().find('[data-testid="phases-legend"]').parent().attr('class')
    ).toContain('justify-between')
  })

  test('sizes each graph at its natural size, with no inline style anywhere', () => {
    const $ = graph()
    const svg = $('[data-testid="phases-graph"]').first()
    const width = svg.attr('width')
    const height = svg.attr('height')

    expect(Number(width)).toBeGreaterThan(0)
    expect(svg.attr('viewBox')).toBe(`0 0 ${width} ${height}`)
    expect(svg.attr('class')).toContain('max-w-none')
    expect($('[style]')).toHaveLength(0)
  })

  test('draws a strong edge in the info colour and a dashed edge dashed', () => {
    const $ = graph()
    const strong = $('[data-testid="phases-edge"][data-kind="strong"]')
    const dashed = $('[data-testid="phases-edge"][data-kind="dashed"]').first()

    expect(strong.attr('class')).toBe('stroke-info')
    expect(strong.attr('marker-end')).toBe('url(#phases-phase-0-strong)')
    expect(strong.find('title').text()).toBe(
      'IN_REVIEW → APPROVED: GENERATE_AGREEMENT'
    )
    expect(dashed.attr('stroke-dasharray')).toBe('4 3')
    expect(dashed.attr('marker-end')).toBe('url(#phases-phase-0-arrow)')
  })

  test('draws a bare-code move that runs a process in the info colour and dotted', () => {
    const $ = graph({
      map: {
        ...map,
        moves: [{ ...map.moves[1], kind: 'strong-dotted' }]
      }
    })
    const edge = $('[data-testid="phases-edge"][data-kind="strong-dotted"]')

    expect(edge.attr('class')).toBe('stroke-info')
    expect(edge.attr('stroke-width')).toBe('2')
    expect(edge.attr('stroke-dasharray')).toBe('1 3')
    expect(edge.attr('marker-end')).toBe('url(#phases-phase-0-strong)')
  })

  test('draws an other-phase node dashed, with its name only and its position in the title', () => {
    const $ = graph()
    const other = node($, 'POST_AWARD:AGREEMENT:OFFERED').first()

    expect(other.find('rect').attr('stroke-dasharray')).toBe('4 3')
    expect(
      other
        .find('text')
        .map((_, text) => $(text).text())
        .get()
    ).toEqual(['Offered'])
    expect(other.find('text').attr('font-size')).toBe('11')
    expect(other.find('title').text()).toBe(
      'Offered (POST_AWARD:AGREEMENT:OFFERED)'
    )
    expect(other.attr('href')).toBe(
      '/dev-ops/x?tab=phases&status=POST_AWARD:AGREEMENT:OFFERED'
    )
  })

  test('names a node on line 1 and gives its code muted on line 2', () => {
    const $ = graph()
    const approved = node($, 'PRE_AWARD:REVIEW:APPROVED')
    const name = approved.find('[data-testid="phases-node-name"]')
    const code = approved.find('[data-testid="phases-node-code"]')

    expect(name.text()).toBe('Approved')
    expect(name.attr('font-size')).toBe('13')
    expect(name.attr('class')).toBe('fill-current')
    expect(code.text()).toBe('APPROVED')
    expect(code.attr('font-size')).toBe('10')
    expect(code.attr('class')).toBe('fill-current font-mono opacity-70')
    expect(approved.attr('class')).toContain('text-base-content')
  })

  test('marks the selected node current and outlines a flagged one, with a ⚠ and its finding named', () => {
    const $ = graph({ asked: 'IN_REVIEW' })
    const selected = node($, 'PRE_AWARD:REVIEW:IN_REVIEW')
    const flagged = node($, 'PRE_AWARD:REVIEW:ON_HOLD')

    expect(selected.attr('aria-current')).toBe('true')
    expect(selected.attr('aria-label')).toBe(
      'In review (PRE_AWARD:REVIEW:IN_REVIEW)'
    )
    expect(selected.find('rect').attr('class')).toContain(
      'stroke-base-content '
    )
    expect(selected.find('rect').attr('stroke-width')).toBe('2')
    expect(flagged.attr('aria-current')).toBeUndefined()
    expect(flagged.attr('aria-label')).toBe(
      'On hold (PRE_AWARD:REVIEW:ON_HOLD), finding: dead end'
    )
    expect(flagged.find('title').text()).toBe(flagged.attr('aria-label'))
    expect(flagged.find('rect').attr('class')).toContain('stroke-warning')
    expect(flagged.find('rect').attr('stroke-width')).toBe('2.5')
    expect(flagged.find('[data-testid="phases-node-finding"]').text()).toBe('⚠')
    expect(
      node($, 'PRE_AWARD:REVIEW:APPROVED').find('rect').attr('class')
    ).toContain('stroke-base-content/25')
  })

  test('chips a starting status and one GAS accepts from any status under the node', () => {
    const $ = graph()

    expect(
      node($, 'PRE_AWARD:REVIEW:IN_REVIEW')
        .find('[data-testid="phases-node-chip"]')
        .text()
    ).toBe('start')
    expect(
      node($, 'PRE_AWARD:REVIEW:APPROVED')
        .find('[data-testid="phases-node-chip"]')
        .text()
    ).toBe('↺ any status')
    expect(
      node($, 'PRE_AWARD:REVIEW:ON_HOLD').find(
        '[data-testid="phases-node-chip"]'
      )
    ).toHaveLength(0)
  })

  test('gives each node link a visible focus ring', () => {
    const $ = graph()
    const link = node($, 'PRE_AWARD:REVIEW:APPROVED')

    expect(link.attr('class')).toBe('group text-base-content')
    expect(link.find('rect').attr('class')).toContain(
      'group-focus-visible:[stroke-width:3]'
    )
  })

  test('draws a dot in the tone colour, and none without a tone', () => {
    const $ = graph()

    expect(
      node($, 'PRE_AWARD:REVIEW:IN_REVIEW').find('circle').attr('class')
    ).toBe('fill-info')
    expect(
      node($, 'PRE_AWARD:REVIEW:ON_HOLD').find('circle').attr('class')
    ).toBe('fill-base-content/80')
    expect(node($, 'PRE_AWARD:REVIEW:APPROVED').find('circle')).toHaveLength(0)
    expect(node($, 'PRE_AWARD:REVIEW:APPROVED').find('text').attr('x')).toBe(
      String(
        Number(node($, 'PRE_AWARD:REVIEW:APPROVED').find('rect').attr('x')) + 12
      )
    )
  })

  test('outlines each stage band, and labels it with its name then its code, on a plate drawn over the edges', () => {
    const $ = graph()
    const band = $('[data-testid="phases-band"]').first()
    const label = $('[data-testid="phases-band-label"]').first()

    expect(band.attr('class')).toBe('fill-base-200 stroke-base-300')
    expect(band.attr('stroke-width')).toBe('1')
    expect(label.find('rect').attr('class')).toBe('fill-base-100')
    expect(label.find('tspan').first().text()).toBe('Review application')
    expect(label.find('tspan').first().attr('font-size')).toBe('12')
    expect(label.find('tspan').last().text()).toBe('REVIEW')
    expect(label.find('tspan').last().attr('font-size')).toBe('10')
    expect(label.prevAll('[data-testid="phases-edge"]').length).toBeGreaterThan(
      0
    )
  })

  test('keeps marker ids unique across phases', () => {
    const $ = graph()
    const ids = $('marker')
      .map((_, marker) => $(marker).attr('id'))
      .get()

    expect(ids).toEqual([
      'phases-phase-0-arrow',
      'phases-phase-0-strong',
      'phases-phase-1-arrow',
      'phases-phase-1-strong'
    ])
  })

  test('shows only the legend items passed, each with its sample', () => {
    const $ = graph({
      legend: [
        { kind: 'plain', label: 'Action' },
        { kind: 'flagged', label: 'Finding' },
        { kind: 'start', label: 'Start' },
        {
          kind: 'colour',
          label: 'colour = how CW shows the status to caseworkers'
        }
      ]
    })
    const items = $('[data-testid="phases-legend-item"]')

    expect(items.map((_, item) => flatten($(item).text())).get()).toEqual([
      'Action',
      'Finding',
      'startStart',
      'colour = how CW shows the status to caseworkers'
    ])
    expect(items.first().find('line').attr('class')).toBe('stroke-current')
    expect(items.first().find('line').attr('stroke-dasharray')).toBeUndefined()
    expect(items.eq(1).find('span').attr('class')).toContain(
      'border-2 border-warning'
    )
    expect(items.eq(3).find('.status').attr('class')).toBe('status status-info')
  })

  test('draws the legend samples for strong, dashed and other-phase', () => {
    const $ = graph()
    const items = $('[data-testid="phases-legend-item"]')

    expect(items.eq(0).find('line').attr('class')).toBe('stroke-info')
    expect(items.eq(0).find('line').attr('stroke-width')).toBe('2')
    expect(items.eq(1).find('line').attr('stroke-dasharray')).toBe('4 3')
    expect(items.eq(2).find('span').attr('class')).toContain('border-dashed')
  })

  test('draws the legend sample for a move matched by status code that runs a process like its edge', () => {
    const $ = graph({
      legend: [{ kind: 'strong-dotted', label: 'Matched and runs' }]
    })
    const line = $('[data-testid="phases-legend-item"] line')

    expect(line.attr('class')).toBe('stroke-info')
    expect(line.attr('stroke-width')).toBe('2')
    expect(line.attr('stroke-dasharray')).toBe('1 3')
  })

  test('scrolls each graph at full size in one named region a keyboard can reach, with no fade', () => {
    const $ = graph()
    const region = $('[data-testid="phases-graph"]').first().parent()

    expect(region.attr('class')).toContain('overflow-x-auto')
    expect(region.attr('class')).not.toContain('mask-image')
    expect(region.attr('data-graph-scroll')).toBe('')
    expect(region.attr('tabindex')).toBe('0')
    expect(region.attr('role')).toBe('region')
    expect(region.attr('aria-label')).toBe('Pre-award statuses')
    expect(
      $('[data-testid="phases-phase"]')
        .first()
        .find('[aria-label="Pre-award statuses"]')
    ).toHaveLength(1)
    expect($('[data-testid="phases-graph"]').attr('role')).toBeUndefined()
  })

  test('puts a hidden hint above each graph that says it scrolls sideways, for the element to show', () => {
    const $ = graph()
    const hint = $('[data-testid="phases-scroll-hint"]').first()
    const region = hint.next()

    expect(region.attr('data-testid')).toBe('phases-scroller')
    expect(region.attr('data-hint')).toBe(hint.attr('id'))
    expect(hint.attr('id')).toBe('phases-phase-0-scroll-hint')
    expect(hint.attr('hidden')).toBe('hidden')
    expect(hint.find('[data-testid="do-icon-move-horizontal"]')).toHaveLength(1)
    expect(flatten(hint.text())).toBe(
      'This graph is wider than its card. Scroll sideways, or tab to it and use the arrow keys, to see every status.'
    )
    expect($('[data-testid="phases-scroll-hint"]')).toHaveLength(2)
  })

  test('puts the panel first below lg and sticky beside the graphs from lg, titled with the selected status, around the body', () => {
    const $ = graph({ asked: 'PRE_AWARD:REVIEW:ON_HOLD' })
    const panel = $('[data-testid="phases-panel"]')

    expect(panel.attr('class')).toContain(
      'order-first self-start bg-base-100 lg:sticky lg:top-4 lg:order-none'
    )
    expect(panel.attr('id')).toBe('panel')
    expect(panel.attr('tabindex')).toBe('-1')
    expect(panel.attr('aria-label')).toBe('Status')
    expect(panel.prev().find('[data-testid="phases-phase"]')).toHaveLength(2)
    expect(
      panel.find('[data-testid="phases-panel-title"] [data-name]').text()
    ).toBe('On hold')
    expect(
      panel.find('[data-testid="phases-panel-title"] [data-code]').text()
    ).toBe('ON_HOLD')
    expect(panel.find('[data-testid="body"]').text()).toBe('Panel body')
  })

  test('says a phase has no statuses, and titles no panel on an empty map', () => {
    const $ = graph({
      map: {
        phases: [{ code: 'EMPTY', name: null, stages: [] }],
        moves: []
      }
    })

    expect($('[data-testid="phases-phase-empty"]').text()).toBe('No statuses.')
    expect($('svg[data-testid="phases-graph"]')).toHaveLength(0)
    expect($('[data-testid="phases-panel-title"]')).toHaveLength(0)
  })

  test('warns about each duplicated position above the graphs', () => {
    const $ = graph({
      map: {
        phases: [
          {
            code: 'P',
            name: null,
            stages: [
              {
                code: 'S',
                name: null,
                statuses: [
                  { code: 'A', name: 'A', tone: null, flagged: false },
                  { code: 'A', name: 'A', tone: null, flagged: false }
                ]
              }
            ]
          }
        ],
        moves: []
      }
    })
    const alert = $('[data-testid="phases-duplicates"]')

    expect(alert.attr('role')).toBe('alert')
    expect(flatten(alert.text())).toBe(
      'P:S:A appears more than once in this definition. The graph shows it once, where it first appears.'
    )
  })

  test('shows no warning when no position is duplicated', () => {
    expect(graph()('[data-testid="phases-duplicates"]')).toHaveLength(0)
  })

  test('draws the panel helpers inside the panel body: names first, headings in sentence case', () => {
    const $ = graph(
      {},
      `{% from "state-graph/macro.njk" import stageFacts, statusPanelSection %}
      {{ stageFacts({ phase: { code: 'PRE_AWARD', name: 'Pre-award' }, stage: { code: 'REVIEW', name: null }, testId: 'facts' }) }}
      {% call statusPanelSection({ title: 'Ways out', testId: 'moves' }) %}<p>→ APPROVED</p>{% endcall %}`
    )
    const panel = $('[data-testid="phases-panel"]')
    const facts = panel.find('[data-testid="facts"]')
    const section = panel.find('[data-testid="moves"]')

    expect(
      facts
        .find('dt')
        .map((_, dt) => $(dt).text())
        .get()
    ).toEqual(['Phase', 'Stage'])
    expect(flatten(facts.find('dd').first().text())).toBe('Pre-award PRE_AWARD')
    expect(flatten(facts.find('dd').last().text())).toBe('REVIEW')
    expect(section.find('h3').text()).toBe('Ways out')
    expect(section.find('h3').attr('class')).toBe('mb-1 text-sm font-semibold')
    expect(section.find('h3').next().attr('class')).toBe('space-y-3')
    expect(section.find('p').text()).toBe('→ APPROVED')
  })
})
