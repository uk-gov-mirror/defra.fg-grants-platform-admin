// @vitest-environment happy-dom
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'
import {
  getBucketAtUseCase,
  getCatalogueUseCase
} from '../use-cases/get-catalogue.use-case.ts'
import { queryBucketUseCase } from '../use-cases/query-bucket.use-case.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/query-bucket.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

let server: Server

/** The page as the server draws it, put in the document for the design system's elements to upgrade. */
const open = async (url: string) => {
  const { payload } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials },
    headers: { cookie: 'dev-ops-times=utc' }
  })

  const template = document.createElement('template')
  template.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(payload)?.[1] ?? ''
  document.body.replaceChildren(template.content)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const click = (element: Element | null | undefined) =>
  element?.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true })
  )

/** What a submit would send, the browser's navigation held back. */
const nextSubmit = () =>
  new Promise<{ action: string; fields: [string, string][] }>((resolve) => {
    document.addEventListener(
      'submit',
      (event) => {
        event.preventDefault()
        const form = event.target as HTMLFormElement
        const fields = [...new FormData(form).entries()].map(
          ([name, value]) => [name, String(value)] as [string, string]
        )
        resolve({ action: form.getAttribute('action') ?? '', fields })
      },
      { once: true }
    )
  })

const pickRange = (first: string, last: string) => {
  const chip = document.querySelector('[data-testid="list-range"]')
  click(chip?.querySelector('.gpa-chip'))
  click(chip?.ownerDocument.querySelector(`[data-date="${first}"]`))
  click(chip?.ownerDocument.querySelector(`[data-date="${last}"]`))
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T15:20:00.000Z'))

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
  await import('../views/components/index.ts')
})

beforeEach(() => {
  vi.mocked(getCatalogueUseCase).mockResolvedValue(fullCatalogue)
  vi.mocked(getBucketAtUseCase).mockImplementation(async (path) => ({
    available: true,
    bucket: fullCatalogue.buckets.find((bucket) => bucket.path === path) ?? null
  }))
  vi.mocked(queryBucketUseCase).mockResolvedValue({
    page: null,
    unavailable: false,
    timedOut: false,
    errored: false,
    refused: false,
    refusal: null
  })
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('with the script, two days picked in the range calendar', () => {
  test('send them as From and To, with the filters already chosen', async () => {
    await open('/dev-ops/events/gas/outbox?status=DEAD_LETTER')
    const submitted = nextSubmit()

    pickRange('2026-10-05', '2026-10-10')

    await expect(submitted).resolves.toEqual({
      action: '/dev-ops/events/gas/outbox',
      fields: expect.arrayContaining([
        ['status', 'DEAD_LETTER'],
        ['from', '2026-10-05'],
        ['to', '2026-10-10']
      ])
    })
  })
})
