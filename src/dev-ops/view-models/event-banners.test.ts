import { toBanner, toToasts } from './event-banners.ts'
import type { BannerContext, EventNotice } from './event-banners.ts'

const context: BannerContext = {
  service: 'CW',
  allowed: 5,
  deletionDay: '2 Feb 2027',
  canRedrive: true
}

const notice = (overrides: Partial<EventNotice>): EventNotice => ({
  outcome: 'redriven',
  status: null,
  page: '/dev-ops/events/cw/outbox/x',
  ...overrides
})

describe('toBanner', () => {
  test('nothing to say without a notice', () => {
    expect(toBanner(null, context)).toBeNull()
  })

  test('a notice from before purge existed is a redrive', () => {
    expect(toBanner(notice({}), context)?.title).toBe('Redriven.')
  })

  test('redriven: up to the allowed attempts, or without a count when there is none', () => {
    expect(toBanner(notice({}), context)?.text).toBe(
      'The poller will pick it up shortly and retry it up to 5 times.'
    )
    expect(toBanner(notice({}), { ...context, allowed: null })?.text).toBe(
      'The poller will pick it up shortly and retry it.'
    )
  })

  test('a conflict with no status still says nothing changed', () => {
    expect(
      toBanner(notice({ outcome: 'conflict', action: 'purge' }), context)?.text
    ).toBe('This event can’t be purged now. Nothing has changed.')
  })

  test('purged without a deletion date', () => {
    expect(
      toBanner(notice({ outcome: 'purged', action: 'purge' }), {
        ...context,
        deletionDay: null
      })?.text
    ).toBe('It won’t be retried. You can still redrive it.')
  })

  test('saved: Redrive now only where it can be redriven', () => {
    const saved = notice({ outcome: 'saved', action: 'edit' })

    expect(toBanner(saved, context)?.redriveNow).toBe(true)
    expect(toBanner(saved, { ...context, canRedrive: false })?.redriveNow).toBe(
      false
    )
  })

  test('saved, then a redrive GAS no longer had the event for', () => {
    expect(
      toBanner(
        notice({
          outcome: 'saved',
          action: 'edit',
          redrive: { outcome: 'not-found', status: null }
        }),
        context
      )
    ).toEqual({
      tone: 'danger',
      title: 'Payload saved. Not redriven.',
      text: 'CW no longer has this event. Nothing has changed.',
      redriveNow: false
    })
  })

  test('a refusal with a reason this release has no sentence for still reads as a refusal', () => {
    expect(
      toBanner(
        notice({ outcome: 'refused', action: 'edit', reason: 'NEW_RULE' }),
        context
      )?.text
    ).toBe('CW refused the change. Nothing has changed.')
  })

  test('an outcome another release wrote is no banner', () => {
    expect(
      toBanner(notice({ outcome: 'nope' as 'saved', action: 'edit' }), context)
    ).toBeNull()
  })
})

describe('toToasts', () => {
  test.each([
    [notice({}), [{ tone: 'success', text: 'Event redriven' }]],
    [
      notice({ outcome: 'purged', action: 'purge' }),
      [{ tone: 'info', text: 'Event purged' }]
    ],
    [
      notice({ outcome: 'saved', action: 'edit' }),
      [{ tone: 'success', text: 'Payload saved' }]
    ],
    [
      notice({
        outcome: 'saved',
        action: 'edit',
        redrive: { outcome: 'redriven', status: null }
      }),
      [{ tone: 'success', text: 'Payload saved and redriven' }]
    ],
    [notice({ outcome: 'timed-out' }), []],
    [null, []]
  ])('%#', (given, toasts) => {
    expect(toToasts(given)).toEqual(toasts)
  })
})

test('an action another release wrote is no banner and no toast, and doesn’t throw', () => {
  const unknown = notice({
    outcome: 'archived' as 'saved',
    action: 'archive' as 'edit'
  })

  expect(toBanner(unknown, context)).toBeNull()
  expect(toToasts(unknown)).toEqual([])
})
