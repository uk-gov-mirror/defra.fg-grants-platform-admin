import type {
  GrantRead,
  GrantVersionPage,
  GrantVersionRef
} from '../repositories/grants.repository.ts'
import { findGrantVersionPage } from '../repositories/grants.repository.ts'
import { grantTabs, offersTab } from './grant-tabs.ts'
import type { GrantTabId } from './grant-tabs.ts'
import type { HiddenTab, RecordResult } from './record-reads.ts'
import { isMissing, readRecord } from './record-reads.ts'
import {
  logUnreadEvents,
  readOverviewEvents,
  withEvents
} from './version-events.ts'

export type {
  AgreementDefinition,
  DefinitionFileType,
  GrantDefinition,
  GrantAgreement,
  EntitlementField,
  EntitlementTemplate,
  ExternalStatusMapping,
  GrantEntitlements,
  GrantLifecycle,
  GrantVersionHeader,
  GrantVersionOverview,
  GrantVersionPage,
  GrantVersionRef,
  HelpBlock,
  ProcessAddress,
  ProcessEffect,
  TemplatePosition,
  WayIn
} from '../repositories/grants.repository.ts'

export type GrantPageResult = RecordResult<GrantVersionPage> | HiddenTab

const hidden: HiddenTab = { outcome: 'hidden', page: null }

/** Null when GAS refuses the tab because the version has no file for it. */
const findTabPage = async (
  ref: GrantVersionRef,
  read: GrantRead
): Promise<GrantVersionPage | null> => {
  try {
    return await findGrantVersionPage(ref, read)
  } catch (error) {
    if (isMissing(error, 'NO_DEFINITION_FILE')) {
      return null
    }

    throw error
  }
}

const readPage = (ref: GrantVersionRef, read: GrantRead) =>
  readRecord(
    'grant version',
    () => findTabPage(ref, read),
    'GRANT_VERSION_NOT_FOUND'
  )

/**
 * On Overview the version's events are read beside it, for its Event row. A
 * version that is missing or failed answers at once, its events unawaited.
 */
export const getGrantPageUseCase = async (
  ref: GrantVersionRef,
  tab: GrantTabId
): Promise<GrantPageResult> => {
  const reading = readPage(ref, grantTabs[tab].read)
  const events = readOverviewEvents(tab, 'grant version', () =>
    findGrantVersionPage(ref, 'events')
  )
  const { outcome, page } = await reading

  if (page === null) {
    return outcome === 'found' ? hidden : { outcome, page }
  }

  if (!offersTab(page.header, tab)) {
    return hidden
  }

  const answer = await events
  logUnreadEvents(answer)

  return { outcome, page: withEvents(page, answer) }
}
