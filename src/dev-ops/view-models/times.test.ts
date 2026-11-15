import Joi from 'joi'

import {
  shellQuery,
  timesOf,
  toTime,
  toTimes,
  toTimesDialog,
  toTimesOptions,
  withoutShellKeys
} from './times.ts'

const utc = toTimes('utc')
const uk = toTimes('uk')

describe('toTimes', () => {
  test.each([
    ['nothing', undefined, 'utc'],
    ['a value it does not offer', 'mars', 'utc'],
    ['utc', 'utc', 'utc'],
    ['uk', 'uk', 'uk']
  ])('reads %s as %s', (_name, cookie, choice) => {
    expect(toTimes(cookie).choice).toBe(choice)
  })

  test('reads the choice from the request’s cookie', () => {
    expect(timesOf({ state: { 'dev-ops-times': 'uk' } })).toEqual({
      choice: 'uk',
      zone: 'Europe/London',
      label: 'UK time',
      hint: 'GMT in winter, BST in summer.'
    })
  })

  test('names UTC by the zone the logs use', () => {
    expect(utc).toEqual({
      choice: 'utc',
      zone: 'UTC',
      label: 'UTC',
      hint: 'The same as the logs, queues and the other services.'
    })
  })
})

describe('toTimesOptions', () => {
  test('offers UTC then UK time, ticking the one chosen', () => {
    expect(toTimesOptions(uk)).toEqual([
      {
        value: 'utc',
        text: 'UTC',
        hint: 'The same as the logs, queues and the other services.',
        checked: false
      },
      {
        value: 'uk',
        text: 'UK time',
        hint: 'GMT in winter, BST in summer.',
        checked: true
      }
    ])
  })
})

describe('toTime', () => {
  test.each([
    [
      'in UTC',
      utc,
      '2026-10-13T15:04:00Z',
      '13\u00a0Oct 2026 15:04',
      '13 Oct 2026 15:04:00 UTC'
    ],
    [
      'in UK time in summer',
      uk,
      '2026-10-13T15:04:00Z',
      '13\u00a0Oct 2026 16:04',
      '13 Oct 2026 16:04:00 BST'
    ],
    [
      'in UK time in winter',
      uk,
      '2026-12-13T15:04:09Z',
      '13\u00a0Dec 2026 15:04',
      '13 Dec 2026 15:04:09 GMT'
    ],
    [
      'across midnight in UK time',
      uk,
      '2026-06-30T23:30:00Z',
      '1\u00a0Jul 2026 00:30',
      '1 Jul 2026 00:30:00 BST'
    ],
    [
      'in September, as Sep',
      utc,
      '2026-09-01T08:18:00Z',
      '1\u00a0Sep 2026 08:18',
      '1 Sep 2026 08:18:00 UTC'
    ],
    [
      'in the first of autumn’s two 01:30s, as BST',
      uk,
      '2026-10-25T00:30:00Z',
      '25\u00a0Oct 2026 01:30',
      '25 Oct 2026 01:30:00 BST'
    ],
    [
      'in the second of autumn’s two 01:30s, as GMT',
      uk,
      '2026-10-25T01:30:00Z',
      '25\u00a0Oct 2026 01:30',
      '25 Oct 2026 01:30:00 GMT'
    ],
    [
      'just before spring’s skipped hour, as GMT',
      uk,
      '2026-03-29T00:59:59Z',
      '29\u00a0Mar 2026 00:59',
      '29 Mar 2026 00:59:59 GMT'
    ],
    [
      'just after it, at 02:00 BST',
      uk,
      '2026-03-29T01:00:00Z',
      '29\u00a0Mar 2026 02:00',
      '29 Mar 2026 02:00:00 BST'
    ]
  ])(
    'writes a time %s with no zone, and the zone in its title',
    (_name, times, instant, text, title) => {
      expect(toTime(new Date(instant), times)).toEqual({
        datetime: instant,
        text,
        title
      })
    }
  )
})

describe('toTimesDialog', () => {
  const page = (address: string) => new URL(address, 'https://gpa.example')

  test('asks for this page with the dialog open, keeping its query', () => {
    expect(
      toTimesDialog(page('/dev-ops/clients/gas?status=active'), '/dev-ops')
    ).toEqual({
      href: '/dev-ops/clients/gas?status=active&times=open',
      open: false,
      closeHref: '/dev-ops/clients/gas?status=active',
      action: '/dev-ops/times?back=%2Fdev-ops%2Fclients%2Fgas%3Fstatus%3Dactive'
    })
  })

  test('is open when the address asks for it, and closes back to the page without the ask', () => {
    expect(
      toTimesDialog(
        page('/dev-ops/clients/gas?times=open&status=active'),
        '/dev-ops'
      )
    ).toEqual({
      href: '/dev-ops/clients/gas?status=active&times=open',
      open: true,
      closeHref: '/dev-ops/clients/gas?status=active',
      action: '/dev-ops/times?back=%2Fdev-ops%2Fclients%2Fgas%3Fstatus%3Dactive'
    })
  })

  test('keeps a deep page’s own back within the length every back link has', () => {
    const deepBack = `/dev-ops/events/gas/outbox?back=${encodeURIComponent(
      `/dev-ops/applications?grant=${'g'.repeat(1900)}`
    )}`
    const page = new URL(
      `https://gpa.example/dev-ops/events/gas/outbox/e1?back=${encodeURIComponent(deepBack)}`
    )

    const dialog = toTimesDialog(page, '/dev-ops')
    const back = new URL(dialog.action, 'https://gpa.example').searchParams.get(
      'back'
    )

    expect(back).toBe(dialog.closeHref)
    expect(back?.length).toBeLessThanOrEqual(2048)
    expect(back?.startsWith('/dev-ops/events/gas/outbox/e1')).toBe(true)
  })

  test('opens over the page a form was sent from, for a page drawn in answer to one', () => {
    expect(toTimesDialog(undefined, '/dev-ops/events/gas/outbox/e1')).toEqual({
      href: '/dev-ops/events/gas/outbox/e1?times=open',
      open: false,
      closeHref: '/dev-ops/events/gas/outbox/e1',
      action: '/dev-ops/times?back=%2Fdev-ops%2Fevents%2Fgas%2Foutbox%2Fe1'
    })
  })
})

describe('shellQuery', () => {
  const schema = Joi.object({ back: Joi.string(), ...shellQuery })

  test('lets any page be asked for with the Times dialog open', () => {
    expect(
      schema.validate({ back: '/dev-ops', times: 'open' }).error
    ).toBeUndefined()
  })

  test('takes only the one value the shell writes', () => {
    expect(schema.validate({ times: 'shut' }).error).toBeDefined()
  })
})

describe('withoutShellKeys', () => {
  test('leaves a page only its own params', () => {
    expect(withoutShellKeys({ times: 'open', status: 'FAILED' })).toEqual({
      status: 'FAILED'
    })
  })
})
