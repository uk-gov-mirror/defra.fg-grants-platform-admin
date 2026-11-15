import { ukZone } from './zoned-clock.ts'
import type { VersionSummary } from '../repositories/config-versions.ts'
import type { GrantVersionHeader } from '../use-cases/get-grant-page.use-case.ts'
import { catalogue } from '../use-cases/test-fixtures.ts'
import { grantType } from './grants-page.view-model.ts'
import { workflowType } from './workflows-page.view-model.ts'
import { toVersionHeader } from './version-header.ts'

const header = (
  overrides: Partial<GrantVersionHeader> = {}
): GrantVersionHeader => ({
  code: 'woodland-creation',
  version: '1.2.0',
  status: 'active',
  receivedAt: '2026-10-10T16:25:00.000Z',
  files: { grant: { stored: true, fetchStatus: 'fetched' } },
  versions: [
    {
      version: '2.0.0',
      status: 'draft',
      receivedAt: '2026-10-15T10:04:00.000Z'
    },
    {
      version: '1.2.0',
      status: 'active',
      receivedAt: '2026-10-10T16:25:00.000Z'
    }
  ],
  counterpart: null,
  ...overrides
})

const notStored = { stored: false, fetchStatus: 'pending' } as const

describe('toVersionHeader', () => {
  test.each([
    ['active', 'Active', 'success'],
    ['draft', 'Draft', 'neutral']
  ] as const)('shows a %s version as %s', (status, label, role) => {
    expect(
      toVersionHeader(grantType, header({ status }), 'overview', '', ukZone)
        .status
    ).toEqual({ status: label, role })
  })

  test("titles the status badge with what the list's status means", () => {
    expect(
      toVersionHeader(
        grantType,
        header({ status: 'draft' }),
        'overview',
        '',
        ukZone,
        catalogue
      ).status
    ).toEqual({
      status: 'Draft',
      role: 'neutral',
      title: 'Not yet published as active.'
    })
  })

  test('switches between every version, newest first, as plain links on a small trigger', () => {
    const { switcher } = toVersionHeader(
      grantType,
      header(),
      'overview',
      '',
      ukZone,
      null,
      new Date('2026-10-22T09:00:00.000Z')
    )

    expect(switcher).toMatchObject({
      name: 'Version',
      label: 'Versions of woodland-creation',
      small: true,
      testId: 'grant-switcher',
      panelId: 'grant-switcher-panel'
    })
    expect(switcher.items).toEqual([
      {
        label: '2.0.0',
        status: { status: 'Draft', role: 'neutral' },
        secondary: null,
        note: null,
        aside: '15 Oct 11:04',
        asideTitle: '15 Oct 2026 11:04:00.000',
        href: '/dev-ops/grants/woodland-creation/2.0.0',
        active: false
      },
      {
        label: '1.2.0',
        status: { status: 'Active', role: 'success' },
        secondary: null,
        note: null,
        aside: '10 Oct 17:25',
        asideTitle: '10 Oct 2026 17:25:00.000',
        href: '/dev-ops/grants/woodland-creation/1.2.0',
        active: true
      }
    ])
    expect(switcher.items.some((item) => 'value' in item)).toBe(false)
  })

  test('shows only the time of a version received within the day', () => {
    const { switcher } = toVersionHeader(
      grantType,
      header(),
      'overview',
      '',
      ukZone,
      null,
      new Date('2026-10-15T12:00:00.000Z')
    )

    expect(switcher.items[0].aside).toBe('11:04:00')
  })

  test('shows a received time that is not a date as stored', () => {
    const { switcher } = toVersionHeader(
      grantType,
      header({
        versions: [{ version: '1.2.0', status: 'active', receivedAt: 'soon' }]
      }),
      'overview',
      '',
      ukZone
    )

    expect(switcher.items[0].aside).toBe('soon')
  })

  test('keeps the tab and the list it was opened from on every version', () => {
    const from = '/dev-ops/grants?status=draft'
    const { switcher } = toVersionHeader(
      grantType,
      header(),
      'raw',
      from,
      ukZone
    )

    expect(switcher.items.map(({ href }) => href)).toEqual([
      '/dev-ops/grants/woodland-creation/2.0.0?tab=raw&back=%2Fdev-ops%2Fgrants%3Fstatus%3Ddraft',
      '/dev-ops/grants/woodland-creation/1.2.0?tab=raw&back=%2Fdev-ops%2Fgrants%3Fstatus%3Ddraft'
    ])
  })

  const withState = (
    fetchStatus: VersionSummary['fetchStatus'],
    stored: boolean,
    status: VersionSummary['status'] = 'active'
  ): VersionSummary => ({
    version: '1.2.0',
    status,
    receivedAt: '2026-10-10T16:25:00.000Z',
    fetchStatus,
    stored
  })

  const itemFor = (summary: VersionSummary, record = grantType) =>
    toVersionHeader(
      record,
      header({ versions: [summary] }),
      'overview',
      '',
      ukZone,
      catalogue
    ).switcher.items[0]

  test("shows each version's Definition badge as the list does, titled by its hint", () => {
    expect(itemFor(withState('permanent_error', false))).toMatchObject({
      status: {
        status: 'Failed',
        role: 'error',
        title:
          "GAS refused at least one of this version's files and won't use it."
      },
      secondary: null,
      note: null
    })
  })

  test('adds the status badge, and the draft clause to the title, only on a draft', () => {
    expect(itemFor(withState('fetched', true, 'draft'))).toMatchObject({
      status: {
        status: 'Stored',
        title:
          "GAS has fetched every file of this version (grant, agreement, payment) itself. Draft: GAS won't pick it for new work until it is published as active."
      },
      secondary: {
        status: 'Draft',
        role: 'neutral',
        title: 'Not yet published as active.'
      }
    })
  })

  test.each(['pending', 'transient_error'] as const)(
    'says a version stored but %s is not loaded by the service yet',
    (fetchStatus) => {
      expect(itemFor(withState(fetchStatus, true)).note).toEqual({
        text: '· stored, not loaded by GAS yet',
        title:
          "Every file is stored. GAS hasn't loaded it itself yet, so the list still shows its fetch status."
      })
    }
  )

  test('leaves a stored Failed version Failed, with no note', () => {
    expect(itemFor(withState('permanent_error', true)).note).toBeNull()
  })

  test('names CW on a workflow version, from the workflows list', () => {
    expect(itemFor(withState('pending', true), workflowType).note?.text).toBe(
      '· stored, not loaded by CW yet'
    )
  })

  test('shows the status badge as before when the backend sends no fetch status, or there is no catalogue', () => {
    expect(
      itemFor({
        version: '1.2.0',
        status: 'active',
        receivedAt: '2026-10-10T16:25:00.000Z'
      })
    ).toMatchObject({
      status: { status: 'Active', role: 'success' },
      secondary: null,
      note: null
    })
    expect(
      toVersionHeader(
        grantType,
        header({ versions: [withState('fetched', true)] }),
        'overview',
        '',
        ukZone
      ).switcher.items[0].status
    ).toEqual({ status: 'Active', role: 'success' })
  })

  test('has no banner when every file is stored and loaded', () => {
    expect(
      toVersionHeader(
        grantType,
        header({
          files: {
            grant: { stored: true, fetchStatus: 'fetched' },
            payment: { stored: true, fetchStatus: 'fetched' }
          }
        }),
        'overview',
        '',
        ukZone
      ).banner
    ).toBeNull()
  })

  test('posts the fetch for this version while a file is not stored, coming back to the same tab and list', () => {
    const from = '/dev-ops/grants?status=draft'

    expect(
      toVersionHeader(
        grantType,
        header({ files: { grant: notStored } }),
        'raw',
        from,
        ukZone
      ).banner?.fetch
    ).toEqual({
      action: '/dev-ops/grants/woodland-creation/1.2.0/fetch',
      back: from,
      tab: 'raw',
      label: 'Fetch definitions'
    })
  })

  test('offers no fetch when every file is stored, though one is not loaded', () => {
    expect(
      toVersionHeader(
        grantType,
        header({ files: { grant: { stored: true, fetchStatus: 'pending' } } }),
        'overview',
        '',
        ukZone
      ).banner
    ).toMatchObject({ tone: 'info', fetch: null })
  })

  test('says Fetch definition on a workflow page', () => {
    expect(
      toVersionHeader(
        workflowType,
        { ...header(), files: { workflow: notStored } },
        'raw',
        '',
        ukZone
      ).banner?.fetch
    ).toMatchObject({
      action: '/dev-ops/workflows/woodland-creation/1.2.0/fetch',
      label: 'Fetch definition'
    })
  })

  test('links the newest stored version, newer or older, while the grant file is not stored', () => {
    const banner = toVersionHeader(
      grantType,
      header({
        version: '1.19.0',
        files: { grant: { stored: false, fetchStatus: 'permanent_error' } },
        versions: [
          { ...withState('fetched', true), version: '1.40.4' },
          { ...withState('permanent_error', false), version: '1.19.0' },
          { ...withState('fetched', true), version: '1.18.0' }
        ]
      }),
      'phases',
      '',
      ukZone
    ).banner

    expect(banner?.lines.at(-1)).toEqual([
      'Newest stored version: ',
      {
        link: '1.40.4 ›',
        href: '/dev-ops/grants/woodland-creation/1.40.4?tab=phases'
      }
    ])
  })

  test('links the newest stored older version from the newest version, skipping those not stored', () => {
    const banner = toVersionHeader(
      grantType,
      header({
        files: { grant: notStored },
        versions: [
          withState('pending', false),
          { ...withState('pending', false), version: '1.1.0' },
          { ...withState('fetched', true), version: '1.0.0' }
        ]
      }),
      'overview',
      '',
      ukZone
    ).banner

    expect(banner?.lines.at(-1)).toMatchObject([
      'Newest stored version: ',
      { link: '1.0.0 ›' }
    ])
  })

  test('links the newest stored workflow version on a workflow page', () => {
    const banner = toVersionHeader(
      workflowType,
      {
        ...header(),
        files: { workflow: notStored },
        versions: [
          { ...withState('fetched', true), version: '2.0.0' },
          withState('pending', false),
          { ...withState('fetched', true), version: '1.0.0' }
        ]
      },
      'raw',
      '',
      ukZone
    ).banner

    expect(banner?.lines.at(-1)).toEqual([
      'Newest stored version: ',
      {
        link: '2.0.0 ›',
        href: '/dev-ops/workflows/woodland-creation/2.0.0?tab=raw'
      }
    ])
  })

  test('links no stored version when none older qualifies, or the grant file is stored', () => {
    const lines = (files: object) =>
      toVersionHeader(
        grantType,
        header({
          files: files as never,
          versions: [
            withState('pending', false),
            { ...withState('pending', false), version: '1.0.0' }
          ]
        }),
        'overview',
        '',
        ukZone
      ).banner?.lines ?? []

    expect(lines({ grant: notStored })).toHaveLength(1)
    expect(
      lines({
        grant: { stored: true, fetchStatus: 'fetched' },
        payment: notStored
      })
    ).toHaveLength(1)
  })
})
