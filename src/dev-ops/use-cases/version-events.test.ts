import { logger } from '../../common/logger.ts'
import {
  logUnreadEvents,
  readOverviewEvents,
  versionEventsTimeoutMs,
  withEvents
} from './version-events.ts'

vi.mock(import('../../common/logger.ts'))

const events = { rows: [], more: false }

const shown = async (
  read: Parameters<typeof readOverviewEvents>[2],
  name = 'grant version'
) => withEvents({}, await readOverviewEvents('overview', name, read))

describe('readOverviewEvents', () => {
  test('gives the events GAS read', async () => {
    await expect(
      shown(async () => ({ events, sourceErrors: [] }))
    ).resolves.toEqual({ events })
  })

  test.each(['GAS inbox', 'CW-BE'])(
    'reads an answer naming a source it missed, %s, as unread, never as empty',
    async (hop) => {
      await expect(
        shown(
          async () => ({ events, sourceErrors: [{ hop }] }),
          'workflow version'
        )
      ).resolves.toEqual({ events: null })
    }
  )

  test('reads a failed call as unread, and says why only when asked to', async () => {
    const answer = await readOverviewEvents(
      'overview',
      'grant version',
      async () => {
        throw new Error('Response Error: 500')
      }
    )

    expect(withEvents({}, answer)).toEqual({ events: null })
    expect(logger.warn).not.toHaveBeenCalled()

    logUnreadEvents(answer)

    expect(logger.warn).toHaveBeenCalledWith(
      "Could not read the grant version's events from fg-gas-backend: Error: Response Error: 500"
    )
  })

  test('says nothing of events that were read', async () => {
    logUnreadEvents(
      await readOverviewEvents('overview', 'grant version', async () => ({
        events
      }))
    )
    logUnreadEvents(undefined)

    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('goes on without them when GAS takes too long', async () => {
    vi.useFakeTimers()

    const read = shown(() => new Promise(() => {}))
    await vi.advanceTimersByTimeAsync(versionEventsTimeoutMs)

    await expect(read).resolves.toEqual({ events: null })
    vi.useRealTimers()
  })

  test('reads nothing for another tab', async () => {
    const read = vi.fn()

    await expect(
      readOverviewEvents('phases', 'workflow version', read)
    ).resolves.toBeUndefined()
    expect(withEvents({}, undefined)).toEqual({})
    expect(read).not.toHaveBeenCalled()
  })
})
