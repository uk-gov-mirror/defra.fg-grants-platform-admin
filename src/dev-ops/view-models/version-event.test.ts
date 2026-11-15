import { configEvent } from '../use-cases/test-fixtures.ts'
import { toVersionEvent } from './version-event.ts'

const back = '/dev-ops/grants/woodland/1.2.0'

describe('toVersionEvent', () => {
  test('links the newest event that completed, coming back to the version', () => {
    expect(
      toVersionEvent(
        {
          rows: [
            configEvent('gas', {
              id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
              status: 'DEAD_LETTER'
            }),
            configEvent('gas', {
              id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
              eventId: 'newest-completed'
            }),
            configEvent('gas', {
              id: 'cccccccccccccccccccccccc',
              eventId: 'older'
            })
          ],
          more: false
        },
        'GAS',
        back
      )
    ).toEqual({
      kind: 'held',
      eventId: 'newest-completed',
      href: '/dev-ops/events/gas/inbox/bbbbbbbbbbbbbbbbbbbbbbbb?back=%2Fdev-ops%2Fgrants%2Fwoodland%2F1.2.0'
    })
  })

  test("links CW's event under CW's own address", () => {
    expect(
      toVersionEvent(
        { rows: [configEvent('caseworking')], more: false },
        'CW',
        back
      )
    ).toMatchObject({
      href: expect.stringMatching(/^\/dev-ops\/events\/cw\/inbox\//)
    })
  })

  test('links the newest event held when none has completed yet', () => {
    expect(
      toVersionEvent(
        {
          rows: [
            configEvent('gas', { status: 'PROCESSING', eventId: 'on-its-way' })
          ],
          more: false
        },
        'GAS',
        back
      )
    ).toMatchObject({ kind: 'held', eventId: 'on-its-way' })
  })

  test('says the event is past its deletion date when the inbox, read whole, holds none', () => {
    expect(toVersionEvent({ rows: [], more: false }, 'GAS', back)).toEqual({
      kind: 'gone',
      text: 'No longer held: past its deletion date'
    })
  })

  test('never says past its deletion date when the inbox has more than it gave', () => {
    expect(toVersionEvent({ rows: [], more: true }, 'CW', back)).toEqual({
      kind: 'unread',
      text: 'Not among the newest events in CW’s inbox.'
    })
  })

  test.each([
    ['GAS', null],
    ['CW', undefined]
  ])("says %s's inbox couldn't be read", (source, events) => {
    expect(toVersionEvent(events, source, back)).toEqual({
      kind: 'unread',
      text: `Couldn’t be read from ${source}’s inbox.`
    })
  })
})
