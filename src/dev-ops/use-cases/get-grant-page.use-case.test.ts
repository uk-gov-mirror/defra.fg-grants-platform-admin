import { logger } from '../../common/logger.ts'
import { findGrantVersionPage } from '../repositories/grants.repository.ts'
import type { GrantVersionPage } from '../repositories/grants.repository.ts'
import { getGrantPageUseCase } from './get-grant-page.use-case.ts'

vi.mock(import('../repositories/grants.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const ref = { code: 'woodland-creation', version: '1.2.0' }

const page = (files: object): GrantVersionPage =>
  ({ header: { files } }) as GrantVersionPage

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body }
  })

describe('getGrantPageUseCase', () => {
  test.each([
    ['phases', 'phases'],
    ['questions', 'definition'],
    ['actions', 'definition'],
    ['entitlements', 'entitlements'],
    ['agreement', 'agreement'],
    ['payment', 'payment'],
    ['raw', 'definition']
  ] as const)("reads the %s tab from GAS's %s read", async (tab, read) => {
    const found = page({
      grant: { stored: true, fetchStatus: 'fetched' },
      agreement: { stored: true, fetchStatus: 'fetched' },
      payment: { stored: true, fetchStatus: 'fetched' }
    })
    vi.mocked(findGrantVersionPage).mockResolvedValue(found)

    await expect(getGrantPageUseCase(ref, tab)).resolves.toEqual({
      outcome: 'found',
      page: found
    })
    expect(findGrantVersionPage).toHaveBeenCalledWith(ref, read)
    expect(findGrantVersionPage).toHaveBeenCalledTimes(1)
  })

  test("reads the version's events beside the Overview, for its Event row", async () => {
    const found = page({ grant: { stored: true, fetchStatus: 'fetched' } })
    const events = { rows: [], more: false }
    vi.mocked(findGrantVersionPage).mockImplementation(async (_ref, read) =>
      read === 'events' ? { ...found, events } : found
    )

    await expect(getGrantPageUseCase(ref, 'overview')).resolves.toEqual({
      outcome: 'found',
      page: { ...found, events }
    })
    expect(findGrantVersionPage).toHaveBeenCalledWith(ref, 'overview')
    expect(findGrantVersionPage).toHaveBeenCalledWith(ref, 'events')
  })

  test('reads an inbox GAS answered for without reading it, GAS inbox, as unread, not as empty', async () => {
    const found = page({ grant: { stored: true, fetchStatus: 'fetched' } })
    vi.mocked(findGrantVersionPage)
      .mockResolvedValueOnce(found)
      .mockResolvedValueOnce({
        ...found,
        events: { rows: [], more: false },
        sourceErrors: [{ hop: 'GAS inbox' }]
      })

    await expect(getGrantPageUseCase(ref, 'overview')).resolves.toEqual({
      outcome: 'found',
      page: { ...found, events: null }
    })
  })

  test('reads the events beside the version, not after it', async () => {
    const found = page({ grant: { stored: true, fetchStatus: 'fetched' } })
    const events = { rows: [], more: false }
    const answers: (() => void)[] = []
    vi.mocked(findGrantVersionPage).mockImplementation(
      (_ref, read) =>
        new Promise((resolve) => {
          answers.push(() =>
            resolve(read === 'events' ? { ...found, events } : found)
          )
        })
    )

    const reading = getGrantPageUseCase(ref, 'overview')

    expect(findGrantVersionPage).toHaveBeenCalledWith(ref, 'overview')
    expect(findGrantVersionPage).toHaveBeenCalledWith(ref, 'events')
    answers.forEach((answer) => answer())
    await expect(reading).resolves.toEqual({
      outcome: 'found',
      page: { ...found, events }
    })
  })

  test.each([
    [
      'not found',
      responseError(404, { reason: 'GRANT_VERSION_NOT_FOUND' }),
      'not-found'
    ],
    ['failing', responseError(502), 'unavailable']
  ])(
    'answers a version that is %s at once, not waiting for its events',
    async (_name, error, outcome) => {
      vi.useFakeTimers()
      vi.mocked(findGrantVersionPage).mockImplementation((_ref, read) =>
        read === 'events' ? new Promise(() => {}) : Promise.reject(error)
      )

      const answered = vi.fn()
      const reading = getGrantPageUseCase(ref, 'overview').then(answered)
      await vi.advanceTimersByTimeAsync(0)

      expect(answered).toHaveBeenCalledWith({ outcome, page: null })
      await reading
      vi.useRealTimers()
    }
  )

  test('drops the events of a version that is not found, saying nothing of them', async () => {
    vi.mocked(findGrantVersionPage).mockImplementation(async (_ref, read) => {
      throw read === 'events'
        ? responseError(500)
        : responseError(404, { reason: 'GRANT_VERSION_NOT_FOUND' })
    })

    await expect(getGrantPageUseCase(ref, 'overview')).resolves.toEqual({
      outcome: 'not-found',
      page: null
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test("answers with the version's failure when its events fail too, saying nothing of them", async () => {
    vi.mocked(findGrantVersionPage).mockRejectedValue(responseError(502))

    await expect(getGrantPageUseCase(ref, 'overview')).resolves.toEqual({
      outcome: 'unavailable',
      page: null
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('keeps the Overview when its events cannot be read', async () => {
    const found = page({ grant: { stored: true, fetchStatus: 'fetched' } })
    vi.mocked(findGrantVersionPage).mockImplementation(async (_ref, read) => {
      if (read === 'events') {
        throw responseError(500)
      }

      return found
    })

    await expect(getGrantPageUseCase(ref, 'overview')).resolves.toEqual({
      outcome: 'found',
      page: { ...found, events: null }
    })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not read the grant version's events")
    )
  })

  test('hides a tab for a file the version has not got', async () => {
    vi.mocked(findGrantVersionPage).mockResolvedValue(
      page({ grant: { stored: true, fetchStatus: 'fetched' } })
    )

    await expect(getGrantPageUseCase(ref, 'payment')).resolves.toEqual({
      outcome: 'hidden',
      page: null
    })
  })

  test('shows a tab for a file the version has, stored or not', async () => {
    const found = page({
      grant: { stored: true, fetchStatus: 'fetched' },
      payment: { stored: false, fetchStatus: 'pending' }
    })
    vi.mocked(findGrantVersionPage).mockResolvedValue(found)

    await expect(getGrantPageUseCase(ref, 'payment')).resolves.toEqual({
      outcome: 'found',
      page: found
    })
  })

  test.each(['agreement', 'payment'] as const)(
    'hides the %s tab when GAS says the version has no file for it',
    async (tab) => {
      vi.mocked(findGrantVersionPage).mockRejectedValue(
        responseError(404, { reason: 'NO_DEFINITION_FILE' })
      )

      await expect(getGrantPageUseCase(ref, tab)).resolves.toEqual({
        outcome: 'hidden',
        page: null
      })
    }
  )

  test("is not found only on GAS's own miss of the version", async () => {
    vi.mocked(findGrantVersionPage).mockRejectedValue(
      responseError(404, { reason: 'GRANT_VERSION_NOT_FOUND' })
    )

    await expect(getGrantPageUseCase(ref, 'raw')).resolves.toEqual({
      outcome: 'not-found',
      page: null
    })
  })

  test.each([
    ['a 404 with no reason, a route GAS has not got', 404, 'unavailable'],
    ['a gateway timeout', 504, 'timed-out'],
    ['any other failure', 500, 'unavailable']
  ])('reads %s as an outage', async (_name, status, outcome) => {
    vi.mocked(findGrantVersionPage).mockRejectedValue(responseError(status))

    await expect(getGrantPageUseCase(ref, 'overview')).resolves.toEqual({
      outcome,
      page: null
    })
  })
})
