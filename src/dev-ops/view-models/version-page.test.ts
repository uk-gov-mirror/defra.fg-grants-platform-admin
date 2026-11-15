import { grantVersionHeader, pendingFile } from '../use-cases/test-fixtures.ts'
import { toTabState } from './version-page.ts'
import type { VersionHeader, VersionTab } from './version-page.ts'

const questions: VersionTab = {
  id: 'questions',
  label: 'Questions',
  read: 'definition',
  file: 'grant'
}

const header = (files: VersionHeader['files']): VersionHeader => ({
  ...grantVersionHeader,
  files
})

describe('toTabState', () => {
  test('leaves a tab that needs no file alone', () => {
    expect(
      toTabState({
        kind: 'grant',
        header: grantVersionHeader,
        tab: {
          id: 'overview',
          label: 'Overview',
          read: 'overview',
          file: null
        },
        sectionErrors: []
      })
    ).toBeNull()
  })

  test('waits for a file not stored yet, offering the fetch', () => {
    expect(
      toTabState({
        kind: 'grant',
        header: header({ grant: pendingFile }),
        tab: questions,
        sectionErrors: []
      })
    ).toEqual({
      kind: 'waiting',
      text: 'The questions appear once the grant definition is stored.',
      action: {
        kind: 'fetch',
        text: 'Fetch definitions',
        icon: 'download',
        variant: 'primary'
      }
    })
  })

  test('says a failed file can’t be shown, with nothing to fetch', () => {
    expect(
      toTabState({
        kind: 'workflow',
        header: header({
          workflow: { stored: false, fetchStatus: 'permanent_error' }
        }),
        tab: {
          id: 'tasks',
          label: 'Tasks',
          read: 'definition',
          file: 'workflow'
        },
        sectionErrors: []
      })
    ).toEqual({
      kind: 'failed',
      title: 'The workflow definition failed, so this tab can’t be shown.',
      text: 'CW won’t use this definition. Publish a fixed version.'
    })
  })

  test('says what GAS said when the tab couldn’t be read', () => {
    expect(
      toTabState({
        kind: 'grant',
        header: grantVersionHeader,
        tab: questions,
        sectionErrors: [{ section: 'definition', message: 'GAS timed out' }]
      })
    ).toEqual({
      kind: 'error',
      title: 'The grant definition couldn’t be read: GAS timed out.',
      text: 'The rest of the page is unaffected — refresh to try again.'
    })
  })

  test.each([
    [
      'grant',
      'The stored grant definition is larger than 1 MiB, the most this page shows.'
    ],
    ['workflow', 'The stored grant definition is too large to show here.']
  ] as const)('says a %s document is too large to show', (kind, text) => {
    expect(
      toTabState({
        kind,
        header: grantVersionHeader,
        tab: questions,
        sectionErrors: [{ section: 'definition', message: 'too large to show' }]
      })
    ).toEqual({ kind: 'too-large', text })
  })

  test('leaves a stored, readable tab to show its content', () => {
    expect(
      toTabState({
        kind: 'grant',
        header: grantVersionHeader,
        tab: questions,
        sectionErrors: [{ section: 'phases', message: 'GAS timed out' }]
      })
    ).toBeNull()
  })
})
