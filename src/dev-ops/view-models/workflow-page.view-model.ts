import type {
  WorkflowPage,
  WorkflowVersionHeader,
  WorkflowVersionOverview
} from '../use-cases/get-workflow-page.use-case.ts'
import { workflowTabs } from '../use-cases/workflow-tabs.ts'
import type { WorkflowTabId } from '../use-cases/workflow-tabs.ts'
import type { DefinitionFetchFlash } from './definition-fetch.ts'
import { toGrantHref } from './grants-page.view-model.ts'
import { toTabHref } from './record-page.view-model.ts'
import type { Times } from './times.ts'
import { toVersionEvent } from './version-event.ts'
import type { VersionEvent } from './version-event.ts'
import { toFileRows } from './version-files.ts'
import type { FileRow } from './version-files.ts'
import { toVersionShell } from './version-page.ts'
import type { VersionPageShell, VersionTab } from './version-page.ts'
import { toWorkflowIntegrations } from './workflow-integrations.ts'
import type { WorkflowIntegrations } from './workflow-integrations.ts'
import { toWorkflowPagesTab } from './workflow-pages-tab.ts'
import type { WorkflowPagesTab } from './workflow-pages-tab.ts'
import { toWorkflowPhases } from './workflow-phases.view-model.ts'
import type { WorkflowPhasesTab } from './workflow-phases.view-model.ts'
import { toStageAnchor, toTaskGroups } from './workflow-tasks.view-model.ts'
import type { TaskGroupCard } from './workflow-tasks.view-model.ts'
import { toWorkflowHref, workflowType } from './workflows-page.view-model.ts'
import type { Words } from './words.ts'

/** The grant version of the same code and version, linked when GAS has it. */
export type GrantVersionFact =
  | { kind: 'link'; text: string; href: string }
  | { kind: 'text'; text: string }

/** Who CW lets work the workflow's cases; null while the workflow is not stored. */
export type RolesFact = Words[] | null

export interface WorkflowDetails {
  grant: GrantVersionFact
  roles: RolesFact
  event: VersionEvent
}

export interface WorkflowPageModel extends VersionPageShell {
  details: WorkflowDetails | null
  /** Overview's: the definition file, as a grant version lists its own. */
  files: FileRow[] | null
  phases: WorkflowPhasesTab | null
  taskGroups: TaskGroupCard[] | null
  pages: WorkflowPagesTab | null
  integrations: WorkflowIntegrations | null
  /** The stored workflow, as Raw shows it. */
  raw: string | null
}

/** Query params the workflow's tabs read. */
export interface WorkflowPageQuery {
  /** The selected status on Phases: a full position or a bare CW code. */
  status?: string
}

interface WorkflowPageOptions {
  notice?: DefinitionFetchFlash
  query: WorkflowPageQuery
  times: Times
}

const toVersionTabs = (): VersionTab[] =>
  workflowType.tabs.map(({ id, label }) => ({
    id,
    label,
    ...workflowTabs[id as WorkflowTabId]
  }))

/** Back to this page, so the grant version leads back to the workflow it was opened from. */
const toGrantFact = (
  header: WorkflowVersionHeader,
  back: string
): GrantVersionFact => {
  const name = `${header.code}@${header.version}`

  if (header.counterpart === null) {
    return { kind: 'text', text: 'Couldn’t be checked: GAS didn’t answer.' }
  }

  return header.counterpart.exists
    ? {
        kind: 'link',
        text: name,
        href: toTabHref(toGrantHref(header), 'overview', back)
      }
    : { kind: 'text', text: `None: GAS has no grant version ${name}` }
}

const roleLines = (lead: string, roles: string[]): Words[] =>
  roles.length
    ? [roles.flatMap((role, at) => [at ? ', ' : lead, { code: role }])]
    : []

/** Each list only when it names a role; neither lets any caseworker. */
const toRolesFact = (
  roles: WorkflowVersionOverview['requiredRoles']
): RolesFact => {
  if (roles === null) {
    return null
  }

  const lines = [
    ...roleLines('All of: ', roles.allOf),
    ...roleLines('Any of: ', roles.anyOf)
  ]

  return lines.length ? lines : [['Any caseworker (no roles set)']]
}

const toDetails = (page: WorkflowPage, back: string): WorkflowDetails => ({
  grant: toGrantFact(page.header, back),
  roles: toRolesFact(page.overview?.requiredRoles ?? null),
  event: toVersionEvent(page.events, 'CW', back)
})

interface TabInput {
  page: WorkflowPage
  href: string
  from: string
  query: WorkflowPageQuery
}

/**
 * The grant link comes back to this tab without its own `back`, so links
 * followed back and forth never nest one `back` inside another.
 */
const toPhases = ({ page, href, from, query }: TabInput) => {
  const { header, definition, grantStatusMap } = page
  const self = (selected: string) =>
    toTabHref(href, 'phases', '', { status: selected })

  return definition && grantStatusMap
    ? toWorkflowPhases(
        definition.workflow.phases,
        grantStatusMap,
        query.status,
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
        header,
        { href, from }
      )
    : null
}

const toTasks = ({ page }: TabInput) =>
  page.definition ? toTaskGroups(page.definition.workflow.phases) : null

const toPages = ({ page }: TabInput) =>
  page.definition ? toWorkflowPagesTab(page.definition) : null

const toIntegrations = ({ page }: TabInput) =>
  page.definition ? toWorkflowIntegrations(page.definition) : null

const toRaw = ({ page }: TabInput) =>
  page.raw ? JSON.stringify(page.raw, null, 2) : null

/** Each tab's own model, built only on its own tab. */
const tabModels = {
  phases: toPhases,
  taskGroups: toTasks,
  pages: toPages,
  integrations: toIntegrations,
  raw: toRaw
}

const modelOfTab: Partial<Record<WorkflowTabId, keyof typeof tabModels>> = {
  phases: 'phases',
  tasks: 'taskGroups',
  pages: 'pages',
  integrations: 'integrations',
  raw: 'raw'
}

type TabModels = {
  [K in keyof typeof tabModels]: ReturnType<(typeof tabModels)[K]> | null
}

const toTabModels = (tab: WorkflowTabId, input: TabInput): TabModels => {
  const models = Object.fromEntries(
    Object.keys(tabModels).map((id) => [id, null])
  ) as TabModels
  const key = modelOfTab[tab]

  return key ? { ...models, [key]: tabModels[key](input) } : models
}

export const toWorkflowPage = (
  page: WorkflowPage,
  tab: WorkflowTabId,
  from: string,
  { notice, query, times }: WorkflowPageOptions
): WorkflowPageModel => {
  const href = toWorkflowHref(page.header)
  const tabs = toVersionTabs()

  return {
    ...toVersionShell({
      kind: 'workflow',
      record: workflowType,
      header: page.header,
      tabs,
      tab: tabs.find(({ id }) => id === tab) ?? tabs[0],
      from,
      sectionErrors: page.sectionErrors,
      notice,
      times
    }),
    details:
      tab === 'overview'
        ? toDetails(page, toTabHref(href, 'overview', from))
        : null,
    files: tab === 'overview' ? toFileRows(page.header) : null,
    ...toTabModels(tab, { page, href, from, query })
  }
}
