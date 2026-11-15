import type {
  BucketEntry,
  BucketFact,
  Catalogue
} from './get-catalogue.use-case.ts'
import type {
  AgreementDefinition,
  GrantVersionPage
} from './get-grant-page.use-case.ts'
import type {
  StoredAction,
  StoredTransition,
  StoredValueOption,
  StoredWorkflowPhase,
  StoredWorkflowStatus,
  WorkflowDefinition,
  WorkflowVersionPage
} from './get-workflow-page.use-case.ts'
import type { EventRow } from '../repositories/events.repository.ts'

/** A bucket of events and a bucket of records, shaped as GAS's catalogue describes them. */
export const outboxBucket: BucketEntry = {
  id: 'gas.outbox',
  path: 'events/gas/outbox',
  label: 'GAS outbox',
  service: 'GAS',
  shortLabel: 'Outbox',
  icon: 'activity',
  order: 10,
  noun: { one: 'event', many: 'events' },
  time: { label: 'Created' },
  facts: [
    {
      name: 'status',
      param: 'status',
      label: 'Status',
      values: [
        { value: 'PUBLISHED', label: 'Queued', tone: 'neutral' },
        { value: 'DEAD_LETTER', label: 'Dead letter', tone: 'error' }
      ],
      within: null
    },
    {
      name: 'eventType',
      param: 'event',
      label: 'Event',
      values: [
        { value: 'UpdateCaseStatus', label: 'UpdateCaseStatus' },
        { value: 'Unrecognised', label: 'Unrecognised' }
      ],
      within: null
    },
    {
      name: 'grantCode',
      param: 'grant',
      label: 'Grant',
      values: null,
      within: null
    },
    {
      name: 'lastError.name',
      param: 'error',
      label: 'Error name',
      values: null,
      within: null
    }
  ],
  refs: [
    { kind: 'ref', label: 'Reference' },
    { kind: 'trace', label: 'Trace ID' }
  ],
  indexes: [[], ['status'], ['status', 'eventType']],
  groupings: ['status'],
  title: { label: 'Event', format: 'eventType' },
  columns: [
    { key: 'status', label: 'Status', format: 'badge', fact: 'status' },
    { key: 'grantCode', label: 'Grant', format: 'mono' }
  ],
  audited: false,
  timeline: true,
  summaries: [],
  page: null,
  tab: null
}

/** The same list with audit events among its event types. */
export const auditedOutbox: BucketEntry = {
  ...outboxBucket,
  facts: outboxBucket.facts.map((fact) =>
    fact.name === 'eventType'
      ? {
          ...fact,
          values: [{ value: 'Audit', label: 'Audit' }, ...(fact.values ?? [])]
        }
      : fact
  )
}

const eventsPage = { id: 'events', label: 'GAS events', shortLabel: 'Events' }

/** The outbox and the inbox as the two tabs of one page; the inbox searches by fewer kinds and hides nothing. */
export const pagedOutbox: BucketEntry = {
  ...auditedOutbox,
  page: eventsPage,
  tab: 'Outbox'
}

export const pagedInbox: BucketEntry = {
  ...outboxBucket,
  id: 'gas.inbox',
  path: 'events/gas/inbox',
  label: 'GAS inbox',
  shortLabel: 'Inbox',
  time: { label: 'Received' },
  refs: [{ kind: 'trace', label: 'Trace ID' }],
  page: eventsPage,
  tab: 'Inbox'
}

/** Every status GAS and CW give an event, as both declare them. */
const eventStatusFact: BucketFact = {
  name: 'status',
  param: 'status',
  label: 'Status',
  values: [
    { value: 'PUBLISHED', label: 'Queued', tone: 'neutral' },
    { value: 'PROCESSING', label: 'Processing', tone: 'info' },
    { value: 'FAILED', label: 'Failed', tone: 'warning' },
    { value: 'RESUBMITTED', label: 'Resubmitted', tone: 'warning' },
    { value: 'COMPLETED', label: 'Completed', tone: 'success' },
    { value: 'DEAD_LETTER', label: 'Dead letter', tone: 'error' },
    { value: 'PURGED', label: 'Purged', tone: 'neutral' }
  ],
  within: null
}

const errorFacts: BucketFact[] = [
  {
    name: 'lastError.name',
    param: 'errorname',
    label: 'Error name',
    values: null,
    within: null
  },
  {
    name: 'errorKey',
    param: 'error',
    label: 'Error',
    values: null,
    within: null
  }
]

const queueFacts: Record<'outbox' | 'inbox', Partial<BucketEntry>> = {
  outbox: { shortLabel: 'Outbox', time: { label: 'Created' }, tab: 'Outbox' },
  inbox: { shortLabel: 'Inbox', time: { label: 'Received' }, tab: 'Inbox' }
}

const eventTypes: Record<'outbox' | 'inbox', BucketFact> = {
  outbox: {
    name: 'eventType',
    param: 'event',
    label: 'Event',
    values: [
      { value: 'Audit', label: 'Audit' },
      { value: 'CreateCase', label: 'CreateCase' },
      { value: 'UpdateCaseStatus', label: 'UpdateCaseStatus' }
    ],
    within: null
  },
  inbox: {
    name: 'eventType',
    param: 'event',
    label: 'Event',
    values: [
      { value: 'AgreementStatusUpdated', label: 'AgreementStatusUpdated' },
      { value: 'CaseStatusUpdated', label: 'CaseStatusUpdated' }
    ],
    within: null
  }
}

const queueOrder: Record<string, number> = {
  'GAS outbox': 10,
  'GAS inbox': 20,
  'CW outbox': 30,
  'CW inbox': 40
}

/** An event queue as GAS and CW declare theirs on main: the outbox hides audit events behind a switch. */
const eventQueue = (
  service: 'GAS' | 'CW',
  box: 'outbox' | 'inbox'
): BucketEntry => {
  const svc = service.toLowerCase()

  return {
    id: `${svc}.${box}`,
    path: `events/${svc}/${box}`,
    label: `${service} ${box}`,
    service,
    shortLabel: '',
    icon: 'activity',
    order: queueOrder[`${service} ${box}`],
    noun: { one: 'event', many: 'events' },
    time: { label: '' },
    facts: [eventStatusFact, eventTypes[box], ...errorFacts],
    refs: [
      { kind: 'ref', label: 'Reference' },
      { kind: 'trace', label: 'Trace ID' },
      { kind: 'id', label: 'Event ID' }
    ],
    indexes: [['status'], ['status', 'lastError.name'], ['status', 'errorKey']],
    groupings: ['status'],
    title: { label: 'Event', format: 'eventType' },
    columns: [
      { key: 'status', label: 'Status', format: 'badge', fact: 'status' }
    ],
    audited: false,
    timeline: true,
    summaries: [],
    page: { id: 'events', label: `${service} events`, shortLabel: 'Events' },
    tab: null,
    ...queueFacts[box]
  }
}

export const gasOutbox = eventQueue('GAS', 'outbox')
export const gasInbox = eventQueue('GAS', 'inbox')
export const cwOutbox = eventQueue('CW', 'outbox')
export const cwInbox = eventQueue('CW', 'inbox')

export const applicationsBucket: BucketEntry = {
  id: 'gas.applications',
  path: 'applications',
  label: 'Applications',
  service: 'GAS',
  shortLabel: 'Applications',
  icon: 'file-text',
  order: 70,
  noun: { one: 'application', many: 'applications' },
  time: { label: 'Created' },
  facts: [
    {
      name: 'code',
      param: 'grant',
      label: 'Grant',
      values: [{ value: 'example-grant', label: 'example-grant' }],
      within: null
    },
    {
      name: 'currentConfigVersion',
      param: 'version',
      label: 'Version',
      values: null,
      within: 'code'
    },
    {
      name: 'archived',
      param: 'archived',
      label: 'Archived',
      values: [
        { value: 'true', label: 'Archived' },
        { value: 'false', label: 'Current' }
      ],
      within: null
    }
  ],
  refs: [{ kind: 'ref', label: 'Reference' }],
  indexes: [[], ['code'], ['code', 'currentConfigVersion']],
  groupings: [],
  title: { label: 'Reference', format: 'mono' },
  columns: [
    { key: 'code', label: 'Grant', format: 'mono' },
    { key: 'position', label: 'Status', format: 'position' }
  ],
  audited: true,
  timeline: false,
  summaries: [],
  page: null,
  tab: null
}

const versionStatusFact: BucketFact = {
  name: 'status',
  param: 'status',
  label: 'Status',
  values: [
    {
      value: 'active',
      label: 'Active',
      tone: 'success',
      hint: 'Published by the config broker.'
    },
    {
      value: 'draft',
      label: 'Draft',
      tone: 'neutral',
      hint: 'Not yet published as active.'
    }
  ],
  within: null
}

/** As GAS declares them for a grant version's files. */
const fetchStatusValues: BucketFact['values'] = [
  {
    value: 'fetched',
    label: 'Stored',
    tone: 'success',
    hint: 'GAS has fetched every file of this version (grant, agreement, payment) itself.'
  },
  {
    value: 'pending',
    label: 'Not stored yet',
    tone: 'neutral',
    hint: "At least one of this version's files (grant, agreement, payment) isn't fetched by GAS yet."
  },
  {
    value: 'transient_error',
    label: 'Fetch error',
    tone: 'warning',
    hint: "GAS's last fetch of at least one of this version's files from S3 failed."
  },
  {
    value: 'permanent_error',
    label: 'Failed',
    tone: 'error',
    hint: "GAS refused at least one of this version's files and won't use it."
  }
]

/** Config versions as GAS lists them: one row per grant code and version. */
export const grantsBucket: BucketEntry = {
  id: 'gas.grants',
  path: 'grants',
  label: 'Grants',
  service: 'GAS',
  shortLabel: 'Grants',
  icon: 'scroll-text',
  order: 75,
  noun: { one: 'grant version', many: 'grant versions' },
  time: { label: 'Received' },
  facts: [
    {
      name: 'grantCode',
      param: 'grant',
      label: 'Grant',
      values: [
        { value: 'hedgerow-restoration', label: 'hedgerow-restoration' },
        { value: 'woodland-creation', label: 'woodland-creation' }
      ],
      within: null
    },
    versionStatusFact,
    {
      name: 'worstFetchStatus',
      param: 'definition',
      label: 'Definition',
      values: fetchStatusValues,
      within: null
    }
  ],
  refs: [],
  indexes: [
    [],
    ['grantCode', 'status', 'worstFetchStatus'],
    ['status', 'worstFetchStatus']
  ],
  groupings: [],
  title: { label: 'Grant', format: 'mono' },
  columns: [
    { key: 'version', label: 'Version', format: 'mono' },
    {
      key: 'definition',
      label: 'Definition',
      format: 'badge',
      fact: 'worstFetchStatus'
    },
    { key: 'status', label: 'Status', format: 'badge', fact: 'status' }
  ],
  audited: false,
  timeline: false,
  summaries: [],
  page: null,
  tab: null
}

export const casesBucket: BucketEntry = {
  ...applicationsBucket,
  id: 'cw.cases',
  path: 'cases',
  label: 'Cases',
  service: 'CW',
  shortLabel: 'Cases',
  icon: 'folder',
  order: 80,
  noun: { one: 'case', many: 'cases' },
  facts: [
    {
      name: 'workflowCode',
      param: 'workflow',
      label: 'Workflow',
      values: [{ value: 'example-grant', label: 'example-grant' }],
      within: null
    },
    {
      name: 'currentConfigVersion',
      param: 'version',
      label: 'Version',
      values: null,
      within: 'workflowCode'
    }
  ],
  indexes: [['workflowCode'], ['workflowCode', 'currentConfigVersion']],
  columns: [
    { key: 'workflowCode', label: 'Workflow', format: 'mono' },
    { key: 'position', label: 'Status', format: 'position' }
  ]
}

/** As CW declares them for a workflow version's one file. */
const workflowFetchStatusValues: BucketFact['values'] = [
  {
    value: 'fetched',
    label: 'Stored',
    tone: 'success',
    hint: "CW has loaded this version's workflow definition."
  },
  {
    value: 'pending',
    label: 'Not stored yet',
    tone: 'neutral',
    hint: "This version's workflow definition isn't fetched by CW yet. CW fetches it from S3 when it first needs it, and only uses the newest usable Active version in each major, so an older version may never be fetched; that is normal. A workflow definition stored with Fetch definition shows here until CW loads it itself."
  },
  {
    value: 'transient_error',
    label: 'Fetch error',
    tone: 'warning',
    hint: "CW's last fetch of this version's workflow definition from S3 failed. CW tries again the next time it needs it; after 5 failed fetches it stops trying and marks it Failed the next time it needs this version. Open the version for the error."
  },
  {
    value: 'permanent_error',
    label: 'Failed',
    tone: 'error',
    hint: "CW couldn't fetch or read this version's workflow definition, or stopped after 5 failed fetches, and won't use it. Open the version to see why and what it affects; publish a fixed version."
  }
]

/** Config versions as CW lists them, through GAS; CW keeps one fetch status per version. */
export const workflowsBucket: BucketEntry = {
  ...grantsBucket,
  id: 'cw.workflows',
  path: 'workflows',
  label: 'Workflows',
  service: 'CW',
  shortLabel: 'Workflows',
  icon: 'workflow',
  order: 85,
  noun: { one: 'workflow version', many: 'workflow versions' },
  facts: [
    {
      name: 'grantCode',
      param: 'workflow',
      label: 'Workflow',
      values: [{ value: 'woodland-creation', label: 'woodland-creation' }],
      within: null
    },
    versionStatusFact,
    {
      name: 'fetchStatus',
      param: 'definition',
      label: 'Definition',
      values: workflowFetchStatusValues,
      within: null
    }
  ],
  indexes: [
    ['grantCode', 'status', 'fetchStatus'],
    ['status', 'fetchStatus']
  ],
  title: { label: 'Workflow', format: 'mono' },
  columns: [
    { key: 'version', label: 'Version', format: 'mono' },
    {
      key: 'definition',
      label: 'Definition',
      format: 'badge',
      fact: 'fetchStatus'
    },
    { key: 'status', label: 'Status', format: 'badge', fact: 'status' }
  ]
}

export const catalogue: Catalogue = {
  buckets: [
    outboxBucket,
    applicationsBucket,
    grantsBucket,
    casesBucket,
    workflowsBucket
  ],
  sourceErrors: []
}

const workflowStatus = (
  code: string,
  name: string,
  theme: string,
  overrides: Partial<StoredWorkflowStatus> = {}
): StoredWorkflowStatus => ({
  code,
  name,
  theme,
  interactive: true,
  closes: false,
  hideTaskGroups: false,
  transitions: [],
  ...overrides
})

const go = (
  targetPosition: string,
  action: StoredAction | null = null,
  checkTasks = false
): StoredTransition => ({ targetPosition, checkTasks, action })

const act = (
  code: string,
  name: string,
  comment: StoredAction['comment'] = null,
  confirm = false
): StoredAction => ({ code, name, checkTasks: false, comment, confirm })

/** A value option; one with a comment label asks for a required comment. */
const option = (
  code: string,
  name: string,
  completes: boolean,
  comment?: string
): StoredValueOption => ({
  code,
  name,
  completes,
  comment: comment ? { label: comment, mandatory: true } : null
})

/** The prototype's `woodland-creation@1.2.0` phases, as CW stores them. */
export const woodlandPhases: StoredWorkflowPhase[] = [
  {
    code: 'PRE_AWARD',
    name: 'Pre-award',
    stages: [
      {
        code: 'REVIEW',
        name: 'Review application',
        statuses: [
          workflowStatus('AWAITING_REVIEW', 'Awaiting review', 'NEUTRAL', {
            interactive: false,
            transitions: [
              go(
                'PRE_AWARD:REVIEW:IN_REVIEW',
                act('START_REVIEW', 'Start review')
              )
            ]
          }),
          workflowStatus('IN_REVIEW', 'In review', 'INFO', {
            transitions: [
              go(
                'PRE_AWARD:REVIEW:APPROVED',
                act('APPROVE', 'Approve', { mandatory: false }, true),
                true
              ),
              go(
                'PRE_AWARD:REVIEW:REJECTED',
                act('REJECT', 'Reject', { mandatory: true }, true)
              ),
              go(
                'PRE_AWARD:REVIEW:ON_HOLD',
                act('PUT_ON_HOLD', 'Put on hold', { mandatory: true })
              ),
              go(
                'PRE_AWARD:REVIEW:RFI_SENT',
                act('SEND_RFI', 'Request information', { mandatory: true })
              )
            ]
          }),
          workflowStatus('ON_HOLD', 'On hold', 'NOTICE', {
            transitions: [
              go('PRE_AWARD:REVIEW:IN_REVIEW', act('RESUME', 'Resume review'))
            ]
          }),
          workflowStatus('RFI_SENT', 'Information requested', 'WARN', {
            transitions: [go('PRE_AWARD:REVIEW:IN_REVIEW')]
          }),
          workflowStatus('APPROVED', 'Approved', 'SUCCESS', {
            interactive: false,
            transitions: [go('POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE')]
          }),
          workflowStatus('REJECTED', 'Rejected', 'ERROR', {
            interactive: false,
            closes: true,
            hideTaskGroups: true
          }),
          workflowStatus('WITHDRAWN', 'Withdrawn', 'NEUTRAL', {
            interactive: false,
            closes: true,
            hideTaskGroups: true
          })
        ],
        taskGroups: [
          {
            code: 'CHECKS',
            name: 'Application checks',
            tasks: [
              {
                code: 'CHECK_ELIGIBILITY',
                name: 'Check eligibility',
                mandatory: true,
                requiredRoles: null,
                valueOptions: [
                  option('ACCEPTED', 'Accepted', true),
                  option('RFI', 'Information needed', false, 'What is missing'),
                  option('CANNOT_COMPLETE', 'Cannot complete', false, 'Why')
                ]
              },
              {
                code: 'CHECK_LAND',
                name: 'Check land parcels',
                mandatory: true,
                requiredRoles: null,
                valueOptions: [
                  option('ACCEPTED', 'Accepted', true),
                  option('NOT_ACCEPTED', 'Not accepted', true, 'Which parcels')
                ]
              },
              {
                code: 'SITE_VISIT_DATE',
                name: 'Record site visit date',
                mandatory: false,
                requiredRoles: { allOf: ['ROLE_RPA_CASES_APPROVE'], anyOf: [] },
                input: { type: 'date', label: 'Site visit date' }
              }
            ]
          },
          {
            code: 'APPROVAL',
            name: 'Approval',
            tasks: [
              {
                code: 'SECOND_CHECK',
                name: 'Second check',
                mandatory: true,
                requiredRoles: { allOf: [], anyOf: ['ROLE_RPA_ADMIN'] },
                valueOptions: [
                  option('AGREED', 'Agreed', true),
                  option('NOT_AGREED', 'Not agreed', true, 'Why not')
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  {
    code: 'POST_AWARD',
    name: 'Post-award',
    stages: [
      {
        code: 'AGREEMENT',
        name: 'Agreement',
        statuses: [
          workflowStatus('AWAITING_ACCEPTANCE', 'Awaiting acceptance', 'INFO', {
            interactive: false
          }),
          workflowStatus('ACCEPTED', 'Agreement accepted', 'SUCCESS', {
            interactive: false,
            closes: true
          })
        ],
        taskGroups: []
      }
    ]
  }
]

/** The prototype's `woodland-creation@1.2.0`, as GAS answers its definition read. */
export const woodlandDefinition: WorkflowDefinition = {
  workflow: {
    phases: woodlandPhases,
    pages: {
      cases: {
        details: {
          banner: {
            title: { text: '$.payload.answers.businessName', type: 'string' },
            summary: {
              sbi: {
                label: 'SBI',
                text: '$.payload.identifiers.sbi',
                type: 'string'
              },
              reference: {
                label: 'Reference',
                text: '$.caseRef',
                type: 'string'
              },
              hectares: {
                label: 'Area (ha)',
                text: '$.payload.answers.hectares',
                type: 'number'
              },
              submitted: {
                label: 'Submitted',
                text: '$.payload.submittedAt',
                type: 'date',
                format: 'dd MMM yyyy'
              }
            }
          },
          tabs: {
            'case-details': { content: [{ component: 'summary-list' }] },
            'land-parcels': {
              link: { text: 'Land', index: 2 },
              action: { parcels: 'REFRESH_PARCELS' },
              content: [{ component: 'table' }]
            },
            agreements: {
              link: { text: 'Agreement', index: 5 },
              renderIf: '$.supplementaryData.agreements',
              content: [{ component: 'table' }]
            }
          }
        }
      }
    },
    endpoints: [
      {
        code: 'land-parcels',
        service: 'LAND_DATA',
        path: '/api/v2/parcels/{sbi}',
        method: 'GET'
      },
      {
        code: 'recalculate',
        service: 'PAYMENT_CALC',
        path: '/api/v1/calculate',
        method: 'POST'
      }
    ],
    externalActions: [
      {
        code: 'RECALCULATE',
        name: 'Recalculate payment',
        description: 'Ask the land service for a new payment figure.',
        display: true,
        endpoint: { code: 'recalculate' },
        target: {
          targetNode: 'payment',
          dataType: 'OBJECT',
          position: null,
          place: 'append'
        }
      },
      {
        code: 'REFRESH_PARCELS',
        name: 'Refresh land parcels',
        display: false,
        endpoint: {
          code: 'land-parcels',
          endpointParams: { PATH: { sbi: '$.payload.identifiers.sbi' } }
        },
        target: null
      }
    ]
  },
  addresses: [
    {
      code: 'land-parcels',
      service: 'LAND_DATA',
      url: 'https://land-data.example/api/v2/parcels/{sbi}'
    },
    { code: 'recalculate', service: 'PAYMENT_CALC', url: null }
  ]
}

/** An agreement definition as GAS stores it (`agreements__definitions.definition`). */
export const agreementDefinition: AgreementDefinition = {
  code: 'woodland-creation',
  agreementNumberPrefix: 'WC',
  create: {
    target: 'offered',
    application: '$.input.answers',
    processes: ['GENERATE_OFFER']
  },
  states: {
    offered: {
      page: 'offered',
      on: {
        accept: {
          target: 'accepted',
          page: 'accept',
          validation: {
            required: [
              {
                name: 'confirm',
                value: '$.form.confirm',
                href: '#confirm',
                message: 'Confirm you have read the terms'
              }
            ]
          },
          processes: ['CREATE_AGREEMENT_PAYMENT']
        },
        withdraw: { target: 'withdrawn' },
        cancel: { target: 'cancelled' }
      }
    },
    accepted: {
      page: 'accepted',
      processes: ['GENERATE_OFFER'],
      on: { terminate: { target: 'terminated' } }
    },
    withdrawn: { page: 'withdrawn' },
    cancelled: {},
    terminated: { page: 'terminated' }
  },
  pages: {
    document: {
      title: 'Agreement document',
      layout: 'document',
      components: [{ component: 'heading' }],
      sections: [
        { id: 'parties' },
        { id: 'actions' },
        { id: 'payments' },
        { id: 'terms' }
      ]
    },
    offered: {
      title: 'Review your agreement offer',
      components: [
        { component: 'summary-list' },
        { component: 'button' },
        { component: 'summary-list' }
      ]
    },
    accept: {
      title: 'Accept your agreement offer',
      components: [{ component: 'form' }]
    }
  },
  processDefinitions: {
    GENERATE_OFFER: {
      type: 'endpoint',
      endpoint: {
        method: 'POST',
        service: 'LAND_DATA',
        path: '/api/v2/parcels/{sbi}'
      },
      request: { body: { sbi: '$.application.sbi' } },
      output: {
        offer: '$.response.offer',
        totalAmountPence: '$.response.totalAmountPence'
      }
    },
    FETCH_TERMS: {
      type: 'endpoint',
      endpoint: { method: 'GET', service: 'AGREEMENT_DOCS', path: '/terms' },
      request: { body: {} },
      output: { terms: '$.response.terms' }
    },
    CREATE_AGREEMENT_PAYMENT: { type: 'handler' }
  },
  templates: { terms: { standard: {}, welsh: {} } }
}

/** Every list both services declare, in their catalogue order. */
export const fullCatalogue: Catalogue = {
  buckets: [
    gasOutbox,
    gasInbox,
    { ...applicationsBucket, facts: applicationsBucket.facts.slice(0, 2) },
    grantsBucket,
    cwOutbox,
    cwInbox,
    casesBucket,
    workflowsBucket
  ],
  sourceErrors: []
}

/** A grant version and a workflow version, every file stored and loaded, for their pages' tests. */
export const fetchedFile = { stored: true, fetchStatus: 'fetched' } as const
export const pendingFile = { stored: false, fetchStatus: 'pending' } as const

export const grantVersionHeader: GrantVersionPage['header'] = {
  code: 'woodland-creation',
  version: '1.2.0',
  status: 'active',
  receivedAt: '2026-09-10T15:25:00.000Z',
  s3Bucket: 'grants-config-dev',
  files: {
    grant: { ...fetchedFile, s3Key: 'woodland-creation/1.2.0/grant.json' },
    agreement: {
      ...fetchedFile,
      s3Key: 'woodland-creation/1.2.0/agreement.json'
    },
    payment: { ...fetchedFile, s3Key: 'woodland-creation/1.2.0/payment.json' }
  },
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
    }
  ],
  counterpart: { exists: true }
}

export const grantVersionOverview: NonNullable<GrantVersionPage['overview']> = {
  description: 'Funding to plant new woodland on agricultural land.',
  startDate: '2026-04-01T00:00:00.000Z',
  adminRole: 'FCP.GrantApplicationsAdmin',
  storedBytes: 10035
}

export const workflowVersionHeader: WorkflowVersionPage['header'] = {
  code: 'woodland-creation',
  version: '1.2.0',
  status: 'active',
  receivedAt: '2026-10-10T16:25:00.000Z',
  s3Bucket: 'cw-config-dev',
  files: {
    workflow: { ...fetchedFile, s3Key: 'woodland-creation/1.2.0/workflow.json' }
  },
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
  counterpart: { exists: true }
}

export const workflowVersionOverview: NonNullable<
  WorkflowVersionPage['overview']
> = {
  schemeName: 'Woodland Creation Offer',
  requiredRoles: { allOf: ['ROLE_SFI_REFORM'], anyOf: [] },
  storedBytes: 14540
}

/** The ConfigVersionUpdated event a version arrived as, as its inbox lists it. */
export const configEvent = (
  service: 'gas' | 'caseworking',
  overrides: Partial<EventRow> = {}
): EventRow => ({
  service,
  box: 'inbox',
  id: '6716a9c2e4b0a1f2c3d4e5f6',
  eventId: '5208709c-e2d5-4870-b6ae-ff168bf65726',
  type: 'ConfigVersionUpdated',
  status: 'COMPLETED',
  statusLabel: 'Completed',
  statusRole: 'success',
  statusRetrying: false,
  createdAt: '2026-09-10T15:24:58.000Z',
  latency: 'took 371ms',
  latencyTitle: 'Received to completed',
  ...overrides
})
