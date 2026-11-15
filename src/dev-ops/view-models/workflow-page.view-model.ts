import type {
  WorkflowVersionHeader,
  WorkflowPage,
  WorkflowVersionOverview,
  WorkflowVersionRef
} from '../use-cases/get-workflow-page.use-case.ts'
import type { Catalogue } from '../use-cases/get-catalogue.use-case.ts'
import { workflowTabs } from '../use-cases/workflow-tabs.ts'
import type { WorkflowTabId } from '../use-cases/workflow-tabs.ts'
import { toVersionListHref } from './bucket-links.ts'
import type { DefinitionFetchFlash } from './definition-fetch.ts'
import { toUnavailableSources } from './event-row.ts'
import { grantType, toGrantHref } from './grants-page.view-model.ts'
import {
  toDateFact,
  toNoneFact,
  toLinkFact,
  toReleaseCounterpartFacts,
  toEvents,
  toSizeFact,
  toTabHref,
  toTabSection,
  toTabs,
  toTextFact
} from './record-page.view-model.ts'
import type { Fact, RecordPageModel } from './record-page.view-model.ts'
import type { Zone } from './zoned-clock.ts'
import { toFileLines } from './version-banner.ts'
import { toNotStored, toVersionShell } from './version-page.ts'
import type { NotStored, VersionShell } from './version-page.ts'
import { toWorkflowIntegrations } from './workflow-integrations.ts'
import type { WorkflowIntegrations } from './workflow-integrations.ts'
import { toWorkflowPagesTab } from './workflow-pages-tab.ts'
import type { WorkflowPagesTab } from './workflow-pages-tab.ts'
import { toWorkflowPhases } from './workflow-phases.view-model.ts'
import type { WorkflowPhasesTab } from './workflow-phases.view-model.ts'
import { toStageAnchor, toTaskGroups } from './workflow-tasks.view-model.ts'
import type { TaskGroupCard } from './workflow-tasks.view-model.ts'
import { toWorkflowHref, workflowType } from './workflows-page.view-model.ts'

export interface WorkflowPageModel extends RecordPageModel, VersionShell {
  notStored: NotStored | null
  phases: WorkflowPhasesTab | null
  taskGroups: TaskGroupCard[] | null
  pages: WorkflowPagesTab | null
  integrations: WorkflowIntegrations | null
}

/** Query params the workflow's tabs read. */
export interface WorkflowPageQuery {
  /** The selected status on Phases: a full position or a bare CW code. */
  status?: string
}

const toCasesHref = (
  catalogue: Catalogue | null,
  { code, version }: WorkflowVersionRef
): string | null =>
  toVersionListHref(
    catalogue,
    'cw.cases',
    { codeFact: 'workflowCode', versionFact: 'currentConfigVersion' },
    { code, version }
  )

const whoCanWork = 'Who can work cases'

/** Each list only when it names a role; none at all lets any caseworker. */
const toRolesFact = (roles: WorkflowVersionOverview['requiredRoles']): Fact => {
  if (roles === null) {
    return toNoneFact('roles', whoCanWork)
  }

  const lines = [
    { label: 'all of:', codes: roles.allOf },
    { label: 'any of:', codes: roles.anyOf }
  ].filter(({ codes }) => codes.length)

  return lines.length
    ? { id: 'roles', label: whoCanWork, kind: 'lines', lines }
    : { id: 'roles', label: whoCanWork, kind: 'text', text: 'Any caseworker' }
}

const toFacts = (
  header: WorkflowVersionHeader,
  overview: WorkflowVersionOverview,
  catalogue: Catalogue | null,
  zone: Zone
): Fact[][] => [
  [
    toTextFact('scheme-name', 'Scheme name', overview.schemeName),
    toDateFact('received', 'Received', header.receivedAt, zone),
    toRolesFact(overview.requiredRoles),
    {
      id: 'definition',
      label: 'Definition',
      kind: 'lines',
      lines: toFileLines(workflowType, header, catalogue)
    }
  ],
  [
    ...toReleaseCounterpartFacts(
      grantType,
      header.counterpart,
      toGrantHref(header)
    ),
    toLinkFact('cases', 'Cases', 'View cases', toCasesHref(catalogue, header)),
    toTextFact('versions', 'Versions', String(header.versions.length)),
    toSizeFact(overview.storedBytes, 'Definition size')
  ]
]

const toTasksTab = (
  { definition }: WorkflowPage,
  tab: WorkflowTabId
): TaskGroupCard[] | null =>
  tab === 'tasks' && definition
    ? toTaskGroups(definition.workflow.phases)
    : null

const toPagesTab = (
  { definition }: WorkflowPage,
  tab: WorkflowTabId,
  integrationsHref: string
): WorkflowPagesTab | null =>
  tab === 'pages' && definition
    ? toWorkflowPagesTab(definition, integrationsHref)
    : null

const toIntegrationsTab = (
  { definition }: WorkflowPage,
  tab: WorkflowTabId,
  pagesHref: string
): WorkflowIntegrations | null =>
  tab === 'integrations' && definition
    ? toWorkflowIntegrations(definition, pagesHref)
    : null

/**
 * The grant link comes back to this tab without its own `back`, so links
 * followed back and forth never nest one `back` inside another.
 */
const toPhasesTab = (
  { header, definition, grantStatusMap }: WorkflowPage,
  from: string,
  { status }: WorkflowPageQuery
): WorkflowPhasesTab | null => {
  const href = toWorkflowHref(header)
  const self = (selected: string) =>
    toTabHref(href, 'phases', '', { status: selected })

  return definition && grantStatusMap
    ? toWorkflowPhases(
        definition.workflow.phases,
        grantStatusMap,
        status,
        {
          status: (position) =>
            toTabHref(href, 'phases', from, { status: position }),
          grantStatus: (position, selected) =>
            toTabHref(toGrantHref(header), 'phases', self(selected), {
              status: position
            }),
          grant: (selected) =>
            toTabHref(toGrantHref(header), 'overview', self(selected)),
          tasks: (phase, stage) =>
            `${toTabHref(href, 'tasks', from)}#${toStageAnchor(phase, stage)}`
        },
        header.version
      )
    : null
}

const toOverviewFacts = (
  { header, overview }: WorkflowPage,
  catalogue: Catalogue | null,
  zone: Zone
): Fact[][] | null =>
  overview ? toFacts(header, overview, catalogue, zone) : null

export const toWorkflowPage = (
  page: WorkflowPage,
  tab: WorkflowTabId,
  from: string,
  {
    notice,
    query,
    catalogue,
    zone
  }: {
    notice?: DefinitionFetchFlash
    query: WorkflowPageQuery
    catalogue: Catalogue | null
    zone: Zone
  },
  now: Date = new Date()
): WorkflowPageModel => {
  const href = toWorkflowHref(page.header)
  const { read } = workflowTabs[tab]

  return {
    record: workflowType,
    ref: page.header.code,
    tabs: toTabs(workflowType, href, tab, from),
    tab,
    facts: toOverviewFacts(page, catalogue, zone),
    events: toEvents(page.events, now, zone, toTabHref(href, 'events', from)),
    ...toTabSection(page.raw, page.sectionErrors, tab, read),
    unavailableSources: toUnavailableSources(page.sourceErrors),
    ...toVersionShell(workflowType, page.header, tab, from, {
      notice,
      catalogue,
      now,
      zone
    }),
    notStored: toNotStored(page.header, tab, workflowTabs[tab].file),
    phases: tab === 'phases' ? toPhasesTab(page, from, query) : null,
    taskGroups: toTasksTab(page, tab),
    pages: toPagesTab(page, tab, toTabHref(href, 'integrations', from)),
    integrations: toIntegrationsTab(page, tab, toTabHref(href, 'pages', from))
  }
}
