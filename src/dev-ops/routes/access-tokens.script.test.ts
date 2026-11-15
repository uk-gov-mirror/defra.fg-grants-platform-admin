// @vitest-environment happy-dom
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type { ListedToken } from '../use-cases/access-tokens.use-case.ts'
import { listAccessTokensUseCase } from '../use-cases/access-tokens.use-case.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/access-tokens.use-case.ts'), async (original) => ({
  ...(await original()),
  listAccessTokensUseCase: vi.fn()
}))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const token = (fields: Partial<ListedToken>): ListedToken => ({
  tokenId: '6650c1f2a9e4b1d07c20bd91',
  clientId: 'grants-ui',
  tokenHint: '3e1d',
  status: 'ACTIVE',
  createdAt: null,
  createdBy: null,
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  inUse: false,
  stored: {},
  ...fields
})

const active = '6650c1f2a9e4b1d07c20bd91'
const inUse = '6650c1f2a9e4b1d07c20bd92'

let server: Server

/** The page as the server draws it, put in the document for the design system's elements to upgrade. */
const open = async (url: string) => {
  const { payload } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials }
  })

  const template = document.createElement('template')
  template.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(payload)?.[1] ?? ''
  // Whole, as a browser has the page by the time the module script defines the elements.
  document.body.replaceChildren(template.content)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const dialog = (id: string) => document.getElementById(id) as HTMLDialogElement

const click = (element: Element | null) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  element?.dispatchEvent(event)

  return event
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
  await import('../views/components/index.ts')
})

beforeEach(() => {
  vi.mocked(listAccessTokensUseCase).mockResolvedValue({
    outcome: 'done',
    tokens: [
      token({ tokenId: active }),
      token({
        tokenId: inUse,
        clientId: 'fg-grants-platform-admin',
        tokenHint: '0c4a',
        inUse: true
      })
    ]
  })
})

afterAll(async () => {
  await server.stop()
})

describe('with the script', () => {
  test('a row opens its drawer in place, without leaving the page', async () => {
    await open('/dev-ops/clients/gas')

    const event = click(
      document.querySelector(`a[data-gpa-open="token-${active}"]`)
    )

    expect(event.defaultPrevented).toBe(true)
    expect(dialog(`token-${active}`).open).toBe(true)
    expect(dialog(`token-${inUse}`).open).toBe(false)
  })

  test('the drawer’s buttons open their dialogs over it, and Cancel closes only the dialog', async () => {
    await open('/dev-ops/clients/gas')
    click(document.querySelector(`a[data-gpa-open="token-${active}"]`))

    for (const kind of ['rotate', 'expiry', 'revoke']) {
      const opener = document.querySelector(
        `#token-${active} [data-gpa-open="token-${active}-${kind}"]`
      )
      const event = click(opener)

      expect(event.defaultPrevented).toBe(true)
      expect(dialog(`token-${active}-${kind}`).open).toBe(true)

      click(
        dialog(`token-${active}-${kind}`).querySelector(
          '.gpa-dialog-foot [data-gpa-close]'
        )
      )
      await settle()

      expect(dialog(`token-${active}-${kind}`).open).toBe(false)
      expect(dialog(`token-${active}`).open).toBe(true)
    }
  })

  test('New token opens in place from the header', async () => {
    await open('/dev-ops/clients/gas')

    const event = click(
      document.querySelector('[data-testid="token-new-open"]')
    )

    expect(event.defaultPrevented).toBe(true)
    expect(dialog('token-new').open).toBe(true)
  })

  test('Revoke stays off until the client is typed', async () => {
    await open(`/dev-ops/clients/gas?token=${active}&dialog=revoke`)
    const confirm = dialog(`token-${active}-revoke`).querySelector(
      '[data-gpa-confirm]'
    ) as HTMLButtonElement
    const typed = dialog(`token-${active}-revoke`).querySelector(
      'input[name="confirmText"]'
    ) as HTMLInputElement

    expect(dialog(`token-${active}-revoke`).open).toBe(true)
    expect(confirm.disabled).toBe(true)

    typed.value = 'grants-ui'
    typed.dispatchEvent(new Event('input', { bubbles: true }))

    expect(confirm.disabled).toBe(false)
  })

  test('Revoke on the token in use does nothing when pressed', async () => {
    await open(`/dev-ops/clients/gas?token=${inUse}`)
    const revoke = document.querySelector(
      `#token-${inUse} [data-testid="token-revoke"]`
    )

    const event = click(revoke)

    expect(event.defaultPrevented).toBe(true)
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
  })

  test('a dialog the address asks for arrives open, over its token’s drawer', async () => {
    await open(`/dev-ops/clients/gas?token=${active}&dialog=expiry`)

    expect(dialog(`token-${active}`).open).toBe(true)
    expect(dialog(`token-${active}-expiry`).open).toBe(true)
  })

  test('the client ID’s copy button shows once the script runs', async () => {
    await open(`/dev-ops/clients/gas?token=${active}`)

    expect(
      (
        document.querySelector(
          `#token-${active} gpa-copy [data-gpa-copy]`
        ) as HTMLElement
      ).hidden
    ).toBe(false)
  })
})
