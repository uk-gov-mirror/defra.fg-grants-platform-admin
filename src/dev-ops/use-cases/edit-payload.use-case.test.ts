import { logger } from '../../common/logger.ts'
import type { EventKey } from '../repositories/events.repository.ts'
import { editPayload } from '../repositories/events.repository.ts'
import { editPayloadUseCase } from './edit-payload.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const key: EventKey = {
  service: 'caseworking',
  box: 'inbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b'
}

const secretValue = 'SBI-106284736'
const secretNote = 'the applicant, Jane Doe, asked by phone'

const edit = {
  payload: { data: { sbi: secretValue } },
  note: secretNote,
  revision: 4
}

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body, res: {} }
  })

const everythingLogged = () =>
  JSON.stringify([
    vi.mocked(logger.info).mock.calls,
    vi.mocked(logger.warn).mock.calls,
    vi.mocked(logger.error).mock.calls
  ])

describe('editPayloadUseCase', () => {
  beforeEach(() => {
    vi.mocked(editPayload).mockResolvedValue(undefined)
  })

  test('asks the backend to save the edit on the event the caller named', async () => {
    await editPayloadUseCase(key, edit, 'Ada Lovelace')

    expect(editPayload).toHaveBeenCalledTimes(1)
    expect(editPayload).toHaveBeenCalledWith(key, edit, 'Ada Lovelace')
  })

  test('reports a saved edit', async () => {
    await expect(editPayloadUseCase(key, edit)).resolves.toEqual({
      outcome: 'saved',
      status: null,
      reason: null
    })
  })

  test('reports a 409 as a conflict, in the words the backend sent', async () => {
    vi.mocked(editPayload).mockRejectedValue(
      responseError(409, { status: 'COMPLETED', statusLabel: 'Completed' })
    )

    await expect(editPayloadUseCase(key, edit)).resolves.toEqual({
      outcome: 'conflict',
      status: 'Completed',
      reason: null
    })
  })

  test('falls back to the raw status when a conflict labels none', async () => {
    vi.mocked(editPayload).mockRejectedValue(
      responseError(409, { status: 'COMPLETED' })
    )

    const { status } = await editPayloadUseCase(key, edit)

    expect(status).toBe('COMPLETED')
  })

  test('reports a 412 as stale', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(412))

    await expect(editPayloadUseCase(key, edit)).resolves.toEqual({
      outcome: 'stale',
      status: null,
      reason: null
    })
  })

  test('reports a 422 as refused, with the reason the backend gave', async () => {
    vi.mocked(editPayload).mockRejectedValue(
      responseError(422, { reason: 'DOLLAR_KEY' })
    )

    await expect(editPayloadUseCase(key, edit)).resolves.toEqual({
      outcome: 'refused',
      status: null,
      reason: 'DOLLAR_KEY'
    })
  })

  test('reports a 422 with no reason as refused all the same', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(422))

    await expect(editPayloadUseCase(key, edit)).resolves.toEqual({
      outcome: 'refused',
      status: null,
      reason: null
    })
  })

  test.each([400, 403, 413])(
    'reports a %i as refused, never as unavailable',
    async (statusCode) => {
      vi.mocked(editPayload).mockRejectedValue(responseError(statusCode))

      const { outcome } = await editPayloadUseCase(key, edit)

      expect(outcome).toBe('refused')
    }
  )

  test('reports an event the backend no longer has as not found', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(404))

    const { outcome } = await editPayloadUseCase(key, edit)

    expect(outcome).toBe('not-found')
  })

  test('reports a save nobody answered in time as timed out', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))

    const { outcome } = await editPayloadUseCase(key, edit)

    expect(outcome).toBe('timed-out')
  })

  test.each([
    ['a 5xx', responseError(502)],
    ['a failure carrying no status', new Error('socket hang up')]
  ])('reports %s as unavailable', async (_name, error) => {
    vi.mocked(editPayload).mockRejectedValue(error)

    const { outcome } = await editPayloadUseCase(key, edit)

    expect(outcome).toBe('unavailable')
  })

  test('logs a save as one line naming the event and the outcome', async () => {
    await editPayloadUseCase(key, edit)

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      'Edited event caseworking/inbox/665f1c2e9a1b2c3d4e5f6a7b: saved'
    )
  })

  test.each([
    [409, 'conflict'],
    [412, 'stale'],
    [422, 'refused'],
    [404, 'not-found']
  ])('warns of a %i the backend answered with', async (statusCode, outcome) => {
    vi.mocked(editPayload).mockRejectedValue(responseError(statusCode))

    await editPayloadUseCase(key, edit)

    expect(logger.warn).toHaveBeenCalledWith(
      `Edited event caseworking/inbox/665f1c2e9a1b2c3d4e5f6a7b: ${outcome}`
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test.each([
    [504, 'timed-out'],
    [502, 'unavailable']
  ])('logs a %i as an error', async (statusCode, outcome) => {
    vi.mocked(editPayload).mockRejectedValue(responseError(statusCode))

    await editPayloadUseCase(key, edit)

    expect(logger.error).toHaveBeenCalledWith(
      `Edited event caseworking/inbox/665f1c2e9a1b2c3d4e5f6a7b: ${outcome}`
    )
  })

  test.each([200, 409, 412, 422, 502])(
    'logs neither the payload nor the note nor the body of the answer (%i)',
    async (statusCode) => {
      vi.mocked(editPayload).mockImplementation(async () => {
        if (statusCode !== 200) {
          throw responseError(statusCode, {
            message: `"data.sbi" ${secretValue}`,
            reason: 'NOT_AN_OBJECT'
          })
        }
      })

      await editPayloadUseCase(key, edit)

      expect(everythingLogged()).not.toContain(secretValue)
      expect(everythingLogged()).not.toContain('Jane Doe')
      expect(everythingLogged()).not.toContain('data.sbi')
    }
  )
})
