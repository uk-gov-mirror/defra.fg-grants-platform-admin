import type {
  Overview,
  OverviewResult,
  OverviewSourceError
} from '../use-cases/get-overview.use-case.ts'
import {
  allClear,
  cwTopErrors,
  failed,
  gasConfigFailed,
  gasCounts,
  gasTokensExpiring,
  gasTopErrors,
  needsAttention,
  read,
  toBars,
  toDeadLetters
} from '../use-cases/overview-fixtures.ts'
import {
  toOverviewPage,
  toOverviewStatusCode,
  toPartAlert
} from './overview-page.view-model.ts'
import { toTimes } from './times.ts'

const utc = toTimes('utc')

const page = (overview: Overview, times = utc) =>
  toOverviewPage({ outcome: 'read', overview }, { times })

const sections = (overview: Overview, times = utc) => {
  const drawn = page(overview, times).sections

  if (drawn === null) {
    throw new Error('no sections')
  }

  return drawn
}

const values = (overview: Overview) =>
  sections(overview).figures.map(({ value }) => value)

const timedOut: OverviewSourceError = { hop: 'CW-BE', reason: 'TIMED_OUT' }

describe('the figures', () => {
  test('count each service’s dead letters, the config that failed and the tokens expiring', () => {
    const { figures } = sections(needsAttention)

    expect(figures.map(({ label }) => label)).toEqual([
      'GAS dead letters, last 24 hours',
      'CW dead letters, last 24 hours',
      'Config versions that failed',
      'Access tokens expiring'
    ])
    expect(values(needsAttention)).toEqual(['66', '12', '2', '2'])
    expect(figures[3]!.hint).toBe('within 30 days, or expired')
  })

  test('draw each dead-letter figure’s two-hourly counts as its trend, saying what the line is', () => {
    const [gas, cw, config] = sections(needsAttention).figures

    expect(gas!.trend).toEqual([3, 1, 0, 2, 0, 0, 1, 0, 4, 18, 26, 11])
    expect(cw!.trend).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 1, 3, 5, 2])
    expect(gas!.trendLabel).toBe('Dead letters every two hours, last 24 hours')
    expect(config!.trend).toBeNull()
  })

  test('are all 0 with no trend when all is clear', () => {
    const { figures } = sections(allClear)

    expect(values(allClear)).toEqual(['0', '0', '0', '0'])
    expect(figures.map(({ trend }) => trend)).toEqual([null, null, null, null])
  })

  test('say a count the service stopped at its cap with a plus', () => {
    const overview: Overview = {
      ...needsAttention,
      deadLetters: {
        ...needsAttention.deadLetters,
        gas: read({
          ...toDeadLetters('gas', [10_000, ...Array(11).fill(0)]),
          capped: true
        })
      }
    }

    expect(values(overview)[0]).toBe('10,000+')
  })

  test('leave a figure whose part couldn’t be read empty, never 0', () => {
    const overview: Overview = {
      ...needsAttention,
      deadLetters: { ...needsAttention.deadLetters, cw: failed(timedOut) },
      configFailed: { ...needsAttention.configFailed, gas: failed(timedOut) },
      tokensExpiring: { ...needsAttention.tokensExpiring, cw: failed(timedOut) }
    }

    expect(values(overview)).toEqual(['66', null, null, null])
    expect(sections(overview).figures[1]!.trend).toBeNull()
  })
})

describe('Top errors', () => {
  test('rank both services’ groups together, most first, and show five', () => {
    const { rows } = sections(needsAttention).topErrors

    expect(rows!.map(({ service, count }) => `${service} ${count}`)).toEqual([
      'GAS 214',
      'GAS 96',
      'GAS 41',
      'GAS 23',
      'CW 18'
    ])
  })

  test('name each group by its error, without the `Error: ` GAS keys it with, and its event, with when it was last seen on the Times clock', () => {
    const [first] = sections(needsAttention).topErrors.rows!
    const uk = sections(needsAttention, toTimes('uk')).topErrors.rows![0]!

    expect(first).toMatchObject({
      error: 'Application with clientRef <v> not found',
      event: 'AgreementStatusUpdated',
      lastSeen: {
        datetime: '2026-10-13T14:53:00Z',
        text: '13 Oct 2026 14:53'
      }
    })
    expect(uk.lastSeen!.text).toBe('13 Oct 2026 15:53')
  })

  test('open each group’s dead letters on the list’s own filters, with no time range: they are the current ones', () => {
    const [first] = sections(needsAttention).topErrors.rows!
    const href = new URL(first!.href, 'http://app')

    expect(href.pathname).toBe('/dev-ops/events/gas/inbox')
    expect(Object.fromEntries(href.searchParams)).toEqual({
      status: 'DEAD_LETTER',
      error: 'Error: Application with clientRef <v> not found',
      event: 'AgreementStatusUpdated'
    })
  })

  test('keep the dead letters that recorded no error as their own group, opening exactly those', () => {
    const row = sections(needsAttention).topErrors.rows![3]!

    expect(row.error).toBeNull()
    expect(new URL(row.href, 'http://app').searchParams.get('error')).toBe(
      'No error recorded'
    )
  })

  test('is an empty list when nothing has failed for good', () => {
    expect(sections(allClear).topErrors).toMatchObject({
      rows: [],
      alerts: [],
      partial: null
    })
  })

  test('writes a capped group’s count with a plus', () => {
    const overview: Overview = {
      ...needsAttention,
      topErrors: {
        ...needsAttention.topErrors,
        gas: read({
          ...gasTopErrors,
          entries: [
            { ...gasTopErrors.entries[0]!, count: 100_000, capped: true }
          ]
        })
      }
    }

    expect(sections(overview).topErrors.rows![0]!.count).toBe('100,000+')
  })

  test('says when a service met more kinds of error than it counts', () => {
    const overview: Overview = {
      ...needsAttention,
      topErrors: {
        gas: read({ ...gasTopErrors, complete: false }),
        cw: read({ ...cwTopErrors, complete: false })
      }
    }

    expect(sections(overview).topErrors.partial).toBe(
      'GAS and CW met more kinds of error than they count, so this ranking may miss some.'
    )
  })

  test('keeps the service that answered when the other couldn’t be read, and says which', () => {
    const overview: Overview = {
      ...needsAttention,
      topErrors: { ...needsAttention.topErrors, cw: failed(timedOut) }
    }
    const { rows, alerts } = sections(overview).topErrors

    expect(rows!.map(({ service }) => service)).toEqual([
      'GAS',
      'GAS',
      'GAS',
      'GAS',
      'GAS'
    ])
    expect(alerts).toEqual([
      {
        tone: 'danger',
        title: 'CW’s errors couldn’t be loaded.',
        text: 'CW didn’t answer in time. The rest of the page is unaffected.'
      }
    ])
  })

  test('draws no table when neither service could be read', () => {
    const error: OverviewSourceError = { hop: 'GAS', reason: 'ERRORED' }
    const overview: Overview = {
      ...needsAttention,
      topErrors: { gas: failed(error), cw: failed(timedOut) }
    }
    const { rows, alerts } = sections(overview).topErrors

    expect(rows).toBeNull()
    expect(alerts.map(({ title }) => title)).toEqual([
      'GAS’s errors couldn’t be loaded.',
      'CW’s errors couldn’t be loaded.'
    ])
  })
})

describe('the dead letters chart', () => {
  test('draws both services’ two-hourly bars, each named by the clock it ends at', () => {
    const chart = sections(needsAttention).chart!

    expect(chart.title).toBe('Dead letters, last 24 hours')
    expect(chart.xLabel).toBe('Two hours to')
    expect(chart.x).toEqual([
      '17:00',
      '19:00',
      '21:00',
      '23:00',
      '01:00',
      '03:00',
      '05:00',
      '07:00',
      '09:00',
      '11:00',
      '13:00',
      '15:00'
    ])
    expect(chart.series).toEqual([
      { name: 'GAS', data: [3, 1, 0, 2, 0, 0, 1, 0, 4, 18, 26, 11] },
      { name: 'CW', data: [0, 1, 0, 0, 0, 0, 0, 0, 1, 3, 5, 2] }
    ])
  })

  test('links each box that has dead letters to exactly what it counted, over the window', () => {
    const links = sections(needsAttention).deadLetterLinks

    expect(links.map(({ text }) => text)).toEqual([
      'GAS outbox: 6 dead letters',
      'GAS inbox: 60 dead letters',
      'CW outbox: 1 dead letter',
      'CW inbox: 11 dead letters'
    ])
    expect(links[1]!.href).toBe(
      '/dev-ops/events/gas/inbox?status=DEAD_LETTER&from=2026-10-12T15%3A00%3A00.000Z&to=2026-10-13T15%3A00%3A00.000Z'
    )
  })

  test('leaves out a box with none, and writes a capped box’s count with a plus', () => {
    const dead = toDeadLetters('gas', gasCounts)
    const overview: Overview = {
      ...needsAttention,
      deadLetters: {
        gas: read({
          ...dead,
          lists: [
            { ...dead.lists[0]!, count: 0 },
            { ...dead.lists[1]!, count: 10_000, capped: true }
          ]
        }),
        cw: read(toDeadLetters('cw', Array(12).fill(0)))
      }
    }

    expect(sections(overview).deadLetterLinks.map(({ text }) => text)).toEqual([
      'GAS inbox: 10,000+ dead letters'
    ])
  })

  test('has no links when all is clear', () => {
    expect(sections(allClear).deadLetterLinks).toEqual([])
  })

  test('names the bars on the Times clock', () => {
    expect(sections(needsAttention, toTimes('uk')).chart!.x[0]).toBe('18:00')
  })

  test('says once that it counts by when each event was created, under the chart, and the most in two hours for each service in its summary', () => {
    const chart = sections(needsAttention).chart!

    expect(chart.notes).toEqual([
      'Counted by when each event was created: when it was dead-lettered isn’t stored.'
    ])
    expect(chart.summary).toBe(
      'The most in two hours: GAS 26, to 13:00; CW 5, to 13:00.'
    )
  })

  test('says a service with none as none', () => {
    const overview: Overview = {
      ...needsAttention,
      deadLetters: {
        ...needsAttention.deadLetters,
        cw: read(toDeadLetters('cw', Array(12).fill(0)))
      }
    }

    expect(sections(overview).chart!.summary).toMatch(
      /GAS 26, to 13:00; CW none\.$/
    )
  })

  test('says a two-hour count over the cap is drawn at the cap', () => {
    const counts = [10_000, ...Array(11).fill(0)]
    const overview: Overview = {
      ...needsAttention,
      deadLetters: {
        ...needsAttention.deadLetters,
        gas: read({
          ...toDeadLetters('gas', counts),
          capped: true,
          bars: toBars(counts, [true])
        })
      }
    }

    expect(sections(overview).chart!.notes[1]).toBe(
      'A two-hour count over 10,000 is drawn at 10,000.'
    )
    expect(sections(overview).chart!.summary).toContain('GAS 10,000+, to 17:00')
  })

  test('is not drawn when all is clear', () => {
    expect(sections(allClear).chart).toBeNull()
    expect(sections(allClear).deadLetterAlerts).toEqual([])
  })

  test('is not drawn with one service unread, which is said in its place', () => {
    const overview: Overview = {
      ...needsAttention,
      deadLetters: {
        ...needsAttention.deadLetters,
        gas: failed({ hop: 'GAS', reason: 'UNREACHABLE' })
      }
    }

    expect(sections(overview).chart).toBeNull()
    expect(sections(overview).deadLetterAlerts).toEqual([
      {
        tone: 'danger',
        title: 'GAS’s dead letters couldn’t be loaded.',
        text: 'GAS couldn’t be reached. The rest of the page is unaffected.'
      }
    ])
    expect(sections(overview).deadLetterLinks.map(({ text }) => text)).toEqual([
      'CW outbox: 1 dead letter',
      'CW inbox: 11 dead letters'
    ])
  })
})

describe('Config that failed', () => {
  test('lists both services’ failed versions by name@version, each opening its version page', () => {
    const { rows } = sections(needsAttention).configFailed

    expect(rows).toEqual([
      {
        version: 'frps-private-beta@1.11.0',
        service: 'GAS',
        type: 'Grant',
        definition: { text: 'Failed', tone: 'danger' },
        received: expect.objectContaining({ text: '13 Oct 2026 09:12' }),
        href: '/dev-ops/grants/frps-private-beta/1.11.0'
      },
      {
        version: 'woodland@2.1.0',
        service: 'CW',
        type: 'Workflow',
        definition: { text: 'Fetch error', tone: 'warning' },
        received: null,
        href: '/dev-ops/workflows/woodland/2.1.0'
      }
    ])
  })

  test('is an empty list when every active version is usable', () => {
    expect(sections(allClear).configFailed).toEqual({
      alerts: [],
      rows: [],
      more: null
    })
  })

  test('says when a service sent only the first versions', () => {
    const overview: Overview = {
      ...needsAttention,
      configFailed: {
        ...needsAttention.configFailed,
        gas: read({ ...gasConfigFailed, more: true })
      }
    }

    expect(sections(overview).configFailed.more).toBe(
      'GAS sent the first 1; open its list for the rest.'
    )
  })

  test('keeps the grants when CW’s workflows couldn’t be read', () => {
    const overview: Overview = {
      ...needsAttention,
      configFailed: {
        ...needsAttention.configFailed,
        cw: failed({ hop: 'CW-BE', reason: 'UNREACHABLE' })
      }
    }
    const { rows, alerts } = sections(overview).configFailed

    expect(rows!.map(({ type }) => type)).toEqual(['Grant'])
    expect(alerts[0]).toEqual({
      tone: 'danger',
      title: 'CW’s workflow versions couldn’t be loaded.',
      text: 'CW couldn’t be reached. The rest of the page is unaffected.'
    })
  })
})

describe('Access tokens expiring', () => {
  test('lists both services’ tokens with their state and the UK day each expires, whatever Times says', () => {
    const { rows } = sections(needsAttention, utc).tokensExpiring

    expect(
      rows!.map(({ client, service, status, expires }) => [
        client,
        service,
        status.text,
        expires!.text
      ])
    ).toEqual([
      ['grants-ui', 'GAS', 'Expiring soon', '20 Oct 2026'],
      ['fg-gas-backend', 'CW', 'Expired', '1 Oct 2026']
    ])
  })

  test('draws a token the same whether or not it is in use, which a cached answer can’t say truly', () => {
    const inUse: Overview = {
      ...needsAttention,
      tokensExpiring: {
        ...needsAttention.tokensExpiring,
        gas: read({
          ...gasTokensExpiring,
          tokens: gasTokensExpiring.tokens.map((token) => ({
            ...token,
            inUse: true
          }))
        })
      }
    }

    expect(sections(inUse).tokensExpiring).toEqual(
      sections(needsAttention).tokensExpiring
    )
  })

  test('calls every active token GAS lists Expiring soon, one exactly 30 days out included, as GAS’s window takes it', () => {
    const dayThirty: Overview = {
      ...needsAttention,
      tokensExpiring: {
        ...needsAttention.tokensExpiring,
        gas: read({
          ...gasTokensExpiring,
          tokens: gasTokensExpiring.tokens.map((token) => ({
            ...token,
            expiresAt: '2026-11-12T23:59:59.000Z'
          }))
        })
      }
    }

    expect(sections(dayThirty).tokensExpiring.rows![0]!.status).toEqual({
      text: 'Expiring soon',
      tone: 'warning'
    })
  })

  test('opens each token on its service’s tokens page', () => {
    expect(sections(needsAttention).tokensExpiring.rows![1]!.href).toBe(
      '/dev-ops/clients/cw?token=fg-gas-backend-token'
    )
  })

  test('is an empty list when nothing expires within 30 days', () => {
    expect(sections(allClear).tokensExpiring.rows).toEqual([])
  })

  test('says a CW without access tokens as the tokens page does, not as a failure', () => {
    const overview: Overview = {
      ...needsAttention,
      tokensExpiring: {
        ...needsAttention.tokensExpiring,
        cw: failed({ hop: 'CW-BE', reason: 'NOT_OFFERED' })
      }
    }
    const { rows, alerts } = sections(overview).tokensExpiring

    expect(rows!.map(({ service }) => service)).toEqual(['GAS'])
    expect(alerts).toEqual([
      {
        tone: 'warning',
        title: 'This CW doesn’t offer access tokens.',
        text: 'It’s an older version without the access tokens API. Tokens can be managed here once CW is upgraded.'
      }
    ])
  })
})

describe('toPartAlert', () => {
  test.each([
    ['UNREACHABLE', 'GAS', 'GAS couldn’t be reached.'],
    ['TIMED_OUT', 'GAS', 'GAS didn’t answer in time.'],
    ['ERRORED', 'GAS', 'GAS answered with an error.'],
    ['UNREACHABLE', 'CW-BE', 'CW couldn’t be reached.'],
    ['ERRORED', 'CW-BE', 'CW answered with an error.']
  ] as const)('says %s from %s', (reason, hop, said) => {
    expect(toPartAlert('topErrors', 'cw', { hop, reason }).text).toBe(
      `${said} The rest of the page is unaffected.`
    )
  })

  test('says a part an older service doesn’t offer as a warning', () => {
    expect(
      toPartAlert('configFailed', 'cw', { hop: 'CW-BE', reason: 'NOT_OFFERED' })
    ).toEqual({
      tone: 'warning',
      title: 'This CW doesn’t offer its workflow versions here yet.',
      text: 'It’s an older version. They show here once CW is upgraded. The rest of the page is unaffected.'
    })
  })
})

describe('the page', () => {
  const unread = (result: OverviewResult) =>
    toOverviewPage(result, { times: utc })

  test('is the Overview of both services', () => {
    expect(page(needsAttention)).toMatchObject({
      pageTitle: 'Overview',
      meta: ['Grant Application Service and Caseworking'],
      navActive: 'overview',
      alert: null
    })
  })

  test.each([
    ['not-connected', 'GAS couldn’t be reached.'],
    ['errored', 'GAS answered with an error.'],
    ['timed-out', 'GAS didn’t answer in time.'],
    ['no-answer', 'GAS didn’t answer in time.']
  ] as const)(
    'says it couldn’t be loaded when GAS %s, with Try again',
    (kind, said) => {
      const result: OverviewResult = { outcome: 'failed', failure: { kind } }
      const drawn = unread(result)

      expect(drawn.sections).toBeNull()
      expect(drawn.alert).toMatchObject({
        tone: 'danger',
        title: 'The overview couldn’t be loaded.',
        retryHref: '/dev-ops'
      })
      expect(drawn.alert!.text.startsWith(said)).toBe(true)
      expect(toOverviewStatusCode(result)).toBe(503)
    }
  )

  test('says a GAS without the overview as a warning, with nothing to retry', () => {
    const result: OverviewResult = { outcome: 'not-offered' }

    expect(unread(result).alert).toMatchObject({
      tone: 'warning',
      title: 'This GAS doesn’t offer the overview.',
      retryHref: null
    })
    expect(toOverviewStatusCode(result)).toBe(200)
  })

  test('answers 200 when GAS answered, whatever its parts say', () => {
    expect(
      toOverviewStatusCode({ outcome: 'read', overview: needsAttention })
    ).toBe(200)
  })
})
