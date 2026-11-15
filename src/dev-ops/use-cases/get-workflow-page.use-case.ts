import type {
  WorkflowVersionPage,
  WorkflowVersionRef
} from '../repositories/workflows.repository.ts'
import { findWorkflowVersionPage } from '../repositories/workflows.repository.ts'
import { readGrantStatusMap } from './grant-status-map.ts'
import type { GrantStatusMap } from './grant-status-map.ts'
import type { RecordResult } from './record-reads.ts'
import { readRecord } from './record-reads.ts'
import {
  logUnreadEvents,
  readOverviewEvents,
  withEvents
} from './version-events.ts'
import { workflowTabs } from './workflow-tabs.ts'
import type { WorkflowTabId } from './workflow-tabs.ts'

export type {
  ServiceAddress,
  StoredAction,
  StoredBanner,
  StoredCaseTab,
  StoredCaseView,
  StoredComment,
  StoredDescription,
  StoredEndpoint,
  StoredExternalAction,
  StoredInput,
  StoredLabel,
  StoredTask,
  StoredTaskGroup,
  StoredTransition,
  StoredValueOption,
  StoredWorkflow,
  StoredWorkflowPhase,
  StoredWorkflowStage,
  StoredWorkflowStatus,
  WorkflowDefinition,
  WorkflowFileType,
  WorkflowVersionHeader,
  WorkflowVersionOverview,
  WorkflowVersionPage,
  WorkflowVersionRef
} from '../repositories/workflows.repository.ts'
export type { GrantStatusMap } from './grant-status-map.ts'
export type {
  ExternalStatusMapping,
  GrantLifecycle,
  ProcessEffect
} from '../repositories/grants.repository.ts'

export interface WorkflowPage extends WorkflowVersionPage {
  /** Read on Phases alone, once the workflow is there to show. */
  grantStatusMap?: GrantStatusMap
}

/** Only a shown workflow reads its grant, so GAS audits no grant view nobody saw. */
const withGrantStatusMap = async (
  ref: WorkflowVersionRef,
  result: RecordResult<WorkflowVersionPage>
): Promise<RecordResult<WorkflowPage>> =>
  result.page?.definition
    ? {
        ...result,
        page: { ...result.page, grantStatusMap: await readGrantStatusMap(ref) }
      }
    : result

/**
 * On Overview the version's events are read beside it, for its Event row. A
 * version that is missing or failed answers at once, its events unawaited.
 */
export const getWorkflowPageUseCase = async (
  ref: WorkflowVersionRef,
  tab: WorkflowTabId
): Promise<RecordResult<WorkflowPage>> => {
  const reading = readRecord(
    'workflow version',
    () => findWorkflowVersionPage(ref, workflowTabs[tab].read),
    'WORKFLOW_VERSION_NOT_FOUND'
  )
  const events = readOverviewEvents(tab, 'workflow version', () =>
    findWorkflowVersionPage(ref, 'events')
  )
  const result = await reading

  if (result.page === null) {
    return result
  }

  const answer = await events
  logUnreadEvents(answer)
  const page = withEvents(result.page, answer)

  return tab === 'phases'
    ? withGrantStatusMap(ref, { ...result, page })
    : { ...result, page }
}
