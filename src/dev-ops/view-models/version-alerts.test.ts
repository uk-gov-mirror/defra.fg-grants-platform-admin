import type { DefinitionFile } from '../use-cases/definition-fetches.ts'
import { canFetch, toFetchOutcome, toFileAlerts } from './version-alerts.ts'

const toFileAlert = (...args: Parameters<typeof toFileAlerts>) =>
  toFileAlerts(...args)[0] ?? null
import type { VersionFiles } from './version-files.ts'

const fetched: DefinitionFile = { stored: true, fetchStatus: 'fetched' }
const pending: DefinitionFile = { stored: false, fetchStatus: 'pending' }
const fetchError: DefinitionFile = {
  stored: false,
  fetchStatus: 'transient_error',
  fetchError: 'S3 timed out'
}
const failed: DefinitionFile = {
  stored: false,
  fetchStatus: 'permanent_error',
  fetchError: 'Definition file is not valid JSON'
}

const grant = (files: VersionFiles['files']): VersionFiles => ({
  code: 'woodland',
  version: '1.43.2',
  files
})

const page = '/dev-ops/grants/woodland/1.43.2'

describe('toFileAlerts', () => {
  test('says nothing while every file is stored and loaded', () => {
    expect(
      toFileAlert('grant', grant({ grant: fetched, payment: fetched }))
    ).toBeNull()
  })

  test('offers to fetch the definitions not stored yet', () => {
    expect(
      toFileAlert('grant', grant({ grant: pending, payment: fetched }))
    ).toEqual({
      tone: 'info',
      title: 'GAS fetches each definition from S3 when it first needs it.',
      text: [
        'Fetch them now to see the phases, questions and the rest. The Files list below shows which are stored.'
      ],
      action: {
        kind: 'fetch',
        text: 'Fetch definitions',
        icon: 'download',
        variant: 'primary'
      }
    })
  })

  test('names only the agreement definition when the grant definition is stored', () => {
    expect(
      toFileAlert(
        'grant',
        grant({ grant: fetched, agreement: pending, payment: fetched })
      )
    ).toEqual({
      tone: 'info',
      title: 'The agreement definition isn’t stored yet.',
      text: [
        'GAS stores it when it first creates an agreement for this version. Until then the Agreement tab waits for it; everything else is shown.'
      ],
      action: {
        kind: 'fetch',
        text: 'Fetch it now',
        icon: 'download',
        variant: 'default'
      }
    })
  })

  test('names only the payment definition when the grant definition is stored', () => {
    expect(
      toFileAlert(
        'grant',
        grant({ grant: fetched, agreement: fetched, payment: pending })
      )
    ).toMatchObject({
      tone: 'info',
      title: 'The payment definition isn’t stored yet.',
      text: [
        'GAS stores it when it first resolves a payment for this version. Until then the Payment tab waits for it; everything else is shown.'
      ],
      action: { kind: 'fetch', text: 'Fetch it now' }
    })
  })

  test('names the agreement and payment definitions when only the grant definition is stored', () => {
    expect(
      toFileAlert(
        'grant',
        grant({ grant: fetched, agreement: pending, payment: pending })
      )
    ).toMatchObject({
      tone: 'info',
      title: 'The agreement and payment definitions aren’t stored yet.',
      text: [
        'GAS stores them when it first creates an agreement or resolves a payment for this version. Until then the Agreement and Payment tabs wait for them; everything else is shown.'
      ],
      action: { kind: 'fetch', text: 'Fetch them now', variant: 'default' }
    })
  })

  test('keeps the general wording while the grant definition is not stored, whatever the other files are', () => {
    expect(
      toFileAlert(
        'grant',
        grant({ grant: pending, agreement: pending, payment: pending })
      )
    ).toMatchObject({
      title: 'GAS fetches each definition from S3 when it first needs it.',
      text: [
        'Fetch them now to see the phases, questions and the rest. The Files list below shows which are stored.'
      ]
    })
  })

  test("names GAS's error after a failed fetch, and offers to try again", () => {
    expect(toFileAlert('grant', grant({ grant: fetchError }))).toEqual({
      tone: 'warning',
      title: 'GAS’s last fetch from S3 failed.',
      text: [
        { code: 'S3 timed out' },
        '. GAS tries again the next time it needs the file; after 5 failed fetches it marks it Failed.'
      ],
      action: {
        kind: 'fetch',
        text: 'Try again',
        icon: 'refresh-cw',
        variant: 'default'
      }
    })
  })

  test('names the file when a file other than the grant failed to fetch, which GAS never stops trying', () => {
    expect(
      toFileAlert(
        'grant',
        grant({
          grant: fetched,
          agreement: { ...fetchError, fetchError: null }
        })
      )
    ).toMatchObject({
      title: 'GAS’s last fetch of the agreement definition from S3 failed.',
      text: ['GAS tries again the next time it needs the file.']
    })
  })

  test('says GAS won’t use a version whose grant file failed, with no action', () => {
    expect(
      toFileAlert('grant', grant({ grant: failed, payment: pending }))
    ).toEqual({
      tone: 'danger',
      title: 'GAS won’t use this version.',
      text: [
        'It couldn’t fetch or read the grant definition: ',
        { code: 'Definition file is not valid JSON' },
        '. Publish a fixed version.'
      ],
      action: null
    })
  })

  test('says what a failed payment file stops', () => {
    expect(
      toFileAlert('grant', grant({ grant: fetched, payment: failed }))
    ).toEqual({
      tone: 'danger',
      title: 'Payment definition failed: Definition file is not valid JSON.',
      text: [
        'Payments for this version will fail: GAS has no fallback for a payment definition. Publish a fixed version.'
      ],
      action: null
    })
  })

  test('says what a failed agreement file stops, by its major', () => {
    expect(
      toFileAlert(
        'grant',
        grant({
          grant: fetched,
          agreement: { ...failed, stored: true, fetchError: null }
        })
      )
    ).toEqual({
      tone: 'danger',
      title: 'Agreement definition failed.',
      text: [
        'GAS won’t use this agreement definition: new agreements use the newest usable 1.x one at or below 1.43.2, and actions before acceptance use the newest usable 1.x one. Publish a fixed version.'
      ],
      action: null
    })
  })

  test('says when every file is stored but GAS has not loaded them', () => {
    expect(
      toFileAlert(
        'grant',
        grant({
          grant: { stored: true, fetchStatus: 'pending' },
          payment: fetched
        })
      )
    ).toEqual({
      tone: 'info',
      title: 'Stored, not loaded by GAS yet.',
      text: [
        'Every file is stored. GAS loads them the next time it needs this version.'
      ],
      action: null
    })
  })

  test('shows the worst state first', () => {
    expect(
      toFileAlert(
        'grant',
        grant({ grant: pending, agreement: fetchError, payment: failed })
      )
    ).toMatchObject({ tone: 'danger' })
    expect(
      toFileAlert('grant', grant({ grant: pending, agreement: fetchError }))
    ).toMatchObject({
      tone: 'warning'
    })
  })

  test.each([
    [
      pending,
      'info',
      'CW fetches this definition from S3 when it first needs it.',
      ['Fetch it now to see its phases, tasks, pages and integrations.'],
      'Fetch definition'
    ],
    [
      fetchError,
      'warning',
      'CW’s last fetch from S3 failed.',
      [{ code: 'S3 timed out' }, '. CW tries again the next time it needs it.'],
      'Try again'
    ],
    [
      { ...failed, fetchError: 'The file isn’t valid JSON' },
      'danger',
      'CW won’t use this definition.',
      [{ code: 'The file isn’t valid JSON' }, '. Publish a fixed version.'],
      null
    ],
    [
      { stored: true, fetchStatus: 'transient_error' },
      'info',
      'Stored, not loaded by CW yet.',
      ['CW loads it the next time it needs this version.'],
      null
    ]
  ] as const)(
    'words a workflow file %o in CW’s terms',
    (file, tone, title, text, action) => {
      const alert = toFileAlert('workflow', {
        code: 'woodland',
        version: '1.43.2',
        files: { workflow: file }
      })

      expect(alert).toMatchObject({ tone, title, text })
      expect(alert?.action?.text ?? null).toBe(action)
    }
  )
})

describe('toFileAlerts, with a failed file', () => {
  test('stacks the fetch under a failed file while another can still be fetched', () => {
    expect(
      toFileAlerts('grant', grant({ grant: pending, payment: failed })).map(
        ({ tone, action }) => [tone, action?.text ?? null]
      )
    ).toEqual([
      ['danger', null],
      ['info', 'Fetch definitions']
    ])
    expect(
      toFileAlerts('grant', grant({ grant: fetchError, payment: failed })).map(
        ({ tone, action }) => [tone, action?.text ?? null]
      )
    ).toEqual([
      ['danger', null],
      ['warning', 'Try again']
    ])
  })

  test('stacks nothing under a failed file when nothing else can be fetched', () => {
    expect(
      toFileAlerts('grant', grant({ grant: failed, payment: fetched }))
    ).toHaveLength(1)
  })
})

describe('canFetch', () => {
  test.each([
    [{ grant: pending }, true],
    [{ grant: fetchError }, true],
    [{ grant: failed }, false],
    [{ grant: fetched, payment: failed }, false],
    [{ grant: fetched }, false]
  ])('of %o is %s', (files, can) => {
    expect(canFetch(grant(files))).toBe(can)
  })
})

describe('toFetchOutcome', () => {
  const version = grant({ grant: fetched })

  test('toasts the files stored', () => {
    expect(
      toFetchOutcome(
        'grant',
        {
          page,
          outcome: 'fetched',
          files: [{ file: 'grant', outcome: 'stored' }]
        },
        page,
        version
      )
    ).toEqual({
      alerts: [],
      toast: { tone: 'success', text: 'Definitions stored for woodland@1.43.2' }
    })
  })

  test('toasts a workflow definition stored in the singular', () => {
    expect(
      toFetchOutcome(
        'workflow',
        {
          page,
          outcome: 'fetched',
          files: [{ file: 'workflow', outcome: 'stored' }]
        },
        page,
        version
      ).toast
    ).toEqual({
      tone: 'success',
      text: 'Definition stored for woodland@1.43.2'
    })
  })

  test('says why each file could not be fetched, as GAS keeps no record of a fetch Dev Ops asked for', () => {
    expect(
      toFetchOutcome(
        'grant',
        {
          page,
          outcome: 'fetched',
          files: [
            { file: 'grant', outcome: 'stored' },
            {
              file: 'payment',
              outcome: 'failed',
              reason: 'unparseable',
              message: null
            },
            {
              file: 'agreement',
              outcome: 'failed',
              reason: 'invalid',
              message: 'states.accepted: unknown state'
            }
          ]
        },
        page,
        version
      )
    ).toEqual({
      alerts: [
        {
          tone: 'danger',
          title:
            'The payment definition couldn’t be fetched: the file isn’t valid JSON.',
          text: ['Publish a fixed version. Nothing has changed.'],
          action: null
        },
        {
          tone: 'danger',
          title:
            'The agreement definition couldn’t be fetched: states.accepted: unknown state.',
          text: ['Publish a fixed version. Nothing has changed.'],
          action: null
        }
      ],
      toast: { tone: 'success', text: 'Definitions stored for woodland@1.43.2' }
    })
  })

  test('offers the fetch again, once, while a file that failed to fetch can still be fetched', () => {
    const alerts = toFetchOutcome(
      'workflow',
      {
        page,
        outcome: 'fetched',
        files: [
          {
            file: 'workflow',
            outcome: 'failed',
            reason: 'timeout',
            message: null
          }
        ]
      },
      page,
      { code: 'woodland', version: '1.43.2', files: { workflow: fetchError } }
    ).alerts

    expect(alerts).toEqual([
      {
        tone: 'danger',
        title:
          'The workflow definition couldn’t be fetched: S3 couldn’t return the file.',
        text: ['Try again. Nothing has changed.'],
        action: {
          kind: 'fetch',
          text: 'Try again',
          icon: 'download',
          variant: 'default'
        }
      }
    ])
  })

  test('says a grant fetch GAS did not answer in time may have worked, with Refresh', () => {
    expect(
      toFetchOutcome(
        'grant',
        { page, outcome: 'timed-out', files: [] },
        page,
        version
      )
    ).toEqual({
      alerts: [
        {
          tone: 'warning',
          title: 'Fetch status unknown: GAS didn’t answer in time.',
          text: [
            'The fetch may still have worked. Refresh to check before fetching again.'
          ],
          action: {
            kind: 'refresh',
            text: 'Refresh',
            icon: 'refresh-cw',
            variant: 'default'
          }
        }
      ],
      toast: null
    })
  })

  test('toasts a workflow fetch GAS did not answer in time, as the prototype does', () => {
    expect(
      toFetchOutcome(
        'workflow',
        { page, outcome: 'timed-out', files: [] },
        page,
        version
      )
    ).toEqual({
      alerts: [],
      toast: {
        tone: 'warning',
        text: 'GAS didn’t answer in time — refresh to check'
      }
    })
  })

  test.each(['unavailable', 'not-found'] as const)(
    'says a fetch that came back %s may have stored some files',
    (outcome) => {
      expect(
        toFetchOutcome('grant', { page, outcome, files: [] }, page, version)
          .alerts
      ).toEqual([
        {
          tone: 'danger',
          title:
            'The definitions couldn’t be fetched: GAS answered with an error.',
          text: ['Some files may have been stored. Refresh to check.'],
          action: {
            kind: 'refresh',
            text: 'Refresh',
            icon: 'refresh-cw',
            variant: 'default'
          }
        }
      ])
    }
  )

  test('says nothing of a fetch meant for another version', () => {
    expect(
      toFetchOutcome(
        'grant',
        {
          page: '/dev-ops/grants/woodland/1.0.0',
          outcome: 'timed-out',
          files: []
        },
        page,
        version
      )
    ).toEqual({ alerts: [], toast: null })
  })
})
