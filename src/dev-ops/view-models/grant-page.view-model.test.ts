import { ukZone } from './zoned-clock.ts'
import type {
  GrantVersionHeader,
  GrantVersionOverview
} from '../use-cases/get-grant-page.use-case.ts'
import { toGrantPage } from './grant-page.view-model.ts'

const header: GrantVersionHeader = {
  code: 'woodland-creation',
  version: '1.2.0',
  status: 'active',
  receivedAt: '2026-09-10T15:25:00.000Z',
  files: { grant: { stored: true, fetchStatus: 'fetched' } },
  versions: [
    {
      version: '2.0.0',
      status: 'draft',
      receivedAt: '2026-09-15T09:04:00.000Z'
    },
    {
      version: '1.2.0',
      status: 'active',
      receivedAt: '2026-09-10T15:25:00.000Z'
    },
    {
      version: '1.1.0',
      status: 'active',
      receivedAt: '2026-09-01T10:00:00.000Z'
    }
  ],
  counterpart: null
}

const overview: Omit<GrantVersionOverview, 'adminRole'> = {
  description: null,
  startDate: null,
  storedBytes: null
}

const allowListFact = (
  canAdministerGrants: boolean,
  on: GrantVersionHeader = header,
  adminRole: string | null = 'Grants.Example.Admin'
) =>
  toGrantPage(
    {
      header: on,
      overview: { ...overview, adminRole },
      sourceErrors: [],
      sectionErrors: []
    },
    'overview',
    '',
    { zone: ukZone, query: {}, catalogue: null, canAdministerGrants }
  )
    .facts?.flat()
    .find(({ id }) => id === 'who-can-apply')

const noAdminRole = {
  id: 'who-can-apply',
  label: 'Who can apply',
  kind: 'text',
  text: 'Allow list',
  note: 'the grant has no admin role, so GAS refuses administration to everyone'
}

describe('the Who can apply fact', () => {
  test('links the allow list for a session holding the Grant Ops role', () => {
    expect(allowListFact(true)).toEqual({
      id: 'who-can-apply',
      label: 'Who can apply',
      kind: 'link',
      text: 'Allow list',
      href: '/grant-ops/grants/woodland-creation/admin#who-can-apply'
    })
  })

  test('names the role in place of the link for a session without it', () => {
    expect(allowListFact(false)).toEqual({
      id: 'who-can-apply',
      label: 'Who can apply',
      kind: 'text',
      text: 'Allow list',
      note: 'needs the FCP.GrantApplicationsAdmin role'
    })
  })

  test.each([
    ['blank', '  '],
    ['missing', null]
  ])(
    'says GAS refuses everyone on the current version, stored with its admin role %s, whatever the session holds',
    (_, adminRole) => {
      expect(allowListFact(true, header, adminRole)).toEqual(noAdminRole)
      expect(allowListFact(false, header, adminRole)).toEqual(noAdminRole)
    }
  )

  test('keeps the link on an older version with a blank admin role, as GAS administers by the current one', () => {
    expect(
      allowListFact(true, { ...header, version: '1.1.0' }, '')
    ).toMatchObject({ kind: 'link' })
  })

  test('keeps the link while the grant file is not stored, as its admin role is unknown', () => {
    expect(
      allowListFact(
        true,
        {
          ...header,
          files: { grant: { stored: false, fetchStatus: 'pending' } }
        },
        null
      )
    ).toMatchObject({ kind: 'link' })
  })
})
