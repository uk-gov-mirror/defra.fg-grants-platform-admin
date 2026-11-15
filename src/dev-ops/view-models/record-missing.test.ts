import { applicationType } from './applications-page.view-model.ts'
import { caseType } from './cases-page.view-model.ts'
import { grantType } from './grants-page.view-model.ts'
import { toRecordMissing } from './record-missing.ts'
import { workflowType } from './workflows-page.view-model.ts'

const application = { code: 'frps-private-beta', clientRef: 'a7c-2f1-9e4' }
const aCase = { workflowCode: 'woodland', caseRef: 'f02-7d8-a61' }
const version = { code: 'woodland', version: '1.43.2' }

describe('toRecordMissing', () => {
  test.each([
    [
      applicationType,
      application,
      'a7c-2f1-9e4',
      'GAS has no application a7c-2f1-9e4 for frps-private-beta.',
      'Check the reference and the grant — a reference belongs to one grant. Search for it from Applications.'
    ],
    [
      caseType,
      aCase,
      'f02-7d8-a61',
      'CW has no case f02-7d8-a61.',
      'Check the reference — it may belong to a case that was closed and replaced. Search for it from Cases.'
    ],
    [
      grantType,
      version,
      'woodland',
      'GAS has no record of woodland@1.43.2.',
      'Check the version. If it was published and GAS rejected it on arrival, its message is in GAS’s inbox as a dead letter, unless it has been purged.'
    ],
    [
      workflowType,
      version,
      'woodland',
      'CW has no record of woodland@1.43.2.',
      'Check the version. If it was published and CW rejected it on arrival, its message is in CW’s inbox as a dead letter, unless it has been purged.'
    ]
  ])(
    'says the service has no such $title',
    (record, key, title, messageTitle, text) => {
      const missing = toRecordMissing(record, key, 'not-found')

      expect(missing.title).toBe(title)
      expect(missing.message).toEqual({ title: messageTitle, text })
    }
  )

  test.each([
    [grantType, '/dev-ops/events/gas/inbox', 'Search GAS’s inbox'],
    [workflowType, '/dev-ops/events/cw/inbox', 'Search CW’s inbox for woodland']
  ])(
    'offers a search of the inbox a refused $title version would be in',
    (record, action, text) => {
      expect(toRecordMissing(record, version, 'not-found').inboxSearch).toEqual(
        {
          action,
          code: 'woodland',
          text
        }
      )
    }
  )

  test('offers no search where there is no version to have been refused, or the record was only unreadable', () => {
    expect(
      toRecordMissing(applicationType, application, 'not-found').inboxSearch
    ).toBeNull()
    expect(
      toRecordMissing(grantType, version, 'unavailable').inboxSearch
    ).toBeNull()
  })

  test.each([
    [
      applicationType,
      application,
      'unavailable',
      'This application couldn’t be loaded from GAS.',
      'GAS answered with an error. Nothing has changed — try again in a moment.'
    ],
    [
      applicationType,
      application,
      'timed-out',
      'This application couldn’t be loaded: GAS timed out waiting for it.',
      'Nothing has changed. Try again in a moment.'
    ],
    [
      caseType,
      aCase,
      'unavailable',
      'This case could not be loaded from CW.',
      'CW answered with an error. Nothing has changed — try again in a moment.'
    ],
    [
      caseType,
      aCase,
      'timed-out',
      'This case could not be loaded: CW timed out waiting for it.',
      'Nothing has changed. Refresh to try again.'
    ],
    [
      grantType,
      version,
      'unavailable',
      'This grant could not be loaded from GAS.',
      'GAS answered with an error. Nothing has changed — try again in a moment.'
    ],
    [
      grantType,
      version,
      'timed-out',
      'This grant could not be loaded: GAS timed out waiting for it.',
      'Nothing has changed. Refresh to try again.'
    ],
    [
      workflowType,
      version,
      'unavailable',
      'This workflow couldn’t be loaded from CW.',
      'CW answered with an error. Nothing has changed — try again in a moment.'
    ],
    [
      workflowType,
      version,
      'timed-out',
      'This workflow couldn’t be loaded: CW timed out waiting for it.',
      'Nothing has changed. Refresh to try again.'
    ]
  ] as const)(
    'says a $title is %s in the prototype’s words',
    (record, key, state, title, text) => {
      expect(toRecordMissing(record, key, state).message).toEqual({
        title,
        text
      })
    }
  )

  test.each([
    [
      applicationType,
      application,
      'not-found',
      'Not found – Application a7c-2f1-9e4'
    ],
    [grantType, version, 'not-found', 'Not found – Grant woodland@1.43.2'],
    [workflowType, version, 'timed-out', 'Workflow woodland@1.43.2'],
    [caseType, aCase, 'unavailable', 'Case f02-7d8-a61']
  ] as const)(
    'titles the tab for a $title',
    (record, key, state, pageTitle) => {
      expect(toRecordMissing(record, key, state).pageTitle).toBe(pageTitle)
    }
  )
})
