import type {
  GrantVersionHeader,
  GrantVersionPage
} from '../use-cases/get-grant-page.use-case.ts'
import { grantTabs, offersTab } from '../use-cases/grant-tabs.ts'
import type { GrantTabId } from '../use-cases/grant-tabs.ts'
import type { DefinitionFetchFlash } from './definition-fetch.ts'
import { toGrantQuestions } from './grant-questions.ts'
import { toQuestionsView } from './grant-questions-table.ts'
import type { QuestionsView } from './grant-questions-table.ts'
import { toGrantActions } from './grant-actions.ts'
import type { GrantActionsTab } from './grant-actions.ts'
import { toAgreementTab } from './grant-agreement.view-model.ts'
import type { AgreementTab } from './grant-agreement.view-model.ts'
import { toEntitlementsTab } from './grant-entitlements.ts'
import type { EntitlementsTab, PaymentFileState } from './grant-entitlements.ts'
import { toGrantPhases } from './grant-phases.view-model.ts'
import type { GrantPhasesTab } from './grant-phases.view-model.ts'
import { grantType, toGrantHref } from './grants-page.view-model.ts'
import { toPaymentDefinition } from './payment-definition.ts'
import type { PaymentDefinitionView } from './payment-definition.ts'
import { toTabHref } from './record-page.view-model.ts'
import type { Times } from './times.ts'
import type { VersionAlert } from './version-alerts.ts'
import { toVersionEvent } from './version-event.ts'
import type { VersionEvent } from './version-event.ts'
import { toFileRows } from './version-files.ts'
import type { FileRow } from './version-files.ts'
import { toVersionShell } from './version-page.ts'
import type { VersionPageShell, VersionTab } from './version-page.ts'
import { toWorkflowHref } from './workflows-page.view-model.ts'

export interface GrantPageModel extends VersionPageShell {
  /** Overview's: the event the version arrived as, and its files. */
  event: VersionEvent | null
  files: FileRow[] | null
  phases: GrantPhasesTab | null
  questions: QuestionsView | null
  actions: GrantActionsTab | null
  entitlements: EntitlementsTab | null
  agreement: AgreementTab | null
  payment: PaymentDefinitionView | null
  /** The stored grant definition, as Raw shows it. */
  raw: string | null
}

/** Query params the grant's tabs read. */
export interface GrantPageQuery {
  /** The selected status on Phases. */
  status?: string
}

interface GrantPageOptions {
  notice?: DefinitionFetchFlash
  query: GrantPageQuery
  times: Times
}

/** The version GAS administers the grant by: its newest active one. */
const isCurrent = ({ version, versions }: GrantVersionHeader): boolean =>
  versions.find(({ status }) => status === 'active')?.version === version

/** Only the Overview reads the role, and a role not stored is unknown, never blank. */
const isBlankRole = (overview: GrantVersionPage['overview']): boolean =>
  overview ? !overview.adminRole?.trim() : false

/** GAS refuses administration to everyone while its current version's stored grant has no admin role. */
const hasNoAdminRole = ({ header, overview }: GrantVersionPage): boolean =>
  isCurrent(header) && header.files.grant.stored && isBlankRole(overview)

const noAdminRole: VersionAlert = {
  tone: 'warning',
  title:
    'This grant has no admin role, so GAS refuses administration to everyone.',
  text: [
    'Administration needs an admin role in the grant definition (',
    { code: 'admin.role' },
    ', such as ',
    { code: 'ROLE_WMP_ADMIN' },
    '). Publish a version that sets one.'
  ],
  action: null
}

const toVersionTabs = (header: GrantVersionHeader): VersionTab[] =>
  grantType.tabs
    .filter(({ id }) => offersTab(header, id as GrantTabId))
    .map(({ id, label }) => ({ id, label, ...grantTabs[id as GrantTabId] }))

const toEntitlementsHrefs = (href: string, from: string) => ({
  phases: (status: string | null) =>
    toTabHref(href, 'phases', from, status === null ? {} : { status }),
  payment: toTabHref(href, 'payment', from)
})

/** Null unless CW has the workflow version, so a CW status never links to a page CW cannot show. */
const toWorkflowPhasesHref = (header: GrantVersionHeader) =>
  header.counterpart?.exists
    ? (cwStatus: string, back: string) =>
        toTabHref(toWorkflowHref(header), 'phases', back, { status: cwStatus })
    : null

const toPaymentFileState = ({
  files
}: GrantVersionHeader): PaymentFileState | null => {
  if (!files.payment) {
    return null
  }

  if (files.payment.fetchStatus === 'permanent_error') {
    return 'failed'
  }

  return files.payment.stored ? 'stored' : 'not-stored'
}

/** A tab's link, or null when the version has no file for that tab, so it is not offered. */
const toFileTabHref = (
  { files }: GrantVersionHeader,
  file: 'agreement' | 'payment',
  href: string,
  from: string
): string | null => (files[file] ? toTabHref(href, file, from) : null)

interface TabInput {
  page: GrantVersionPage
  href: string
  from: string
  query: GrantPageQuery
}

const toPhases = ({ page, href, from, query }: TabInput) =>
  toGrantPhases(page, {
    status: query.status,
    href,
    from,
    workflowHref: toWorkflowPhasesHref(page.header)
  })

const toQuestions = ({ page }: TabInput) =>
  page.definition ? toQuestionsView(toGrantQuestions(page.definition)) : null

const toActions = ({ page }: TabInput) =>
  page.definition ? toGrantActions(page.definition.actions) : null

const toEntitlements = ({ page, href, from }: TabInput) =>
  page.entitlements
    ? toEntitlementsTab(
        {
          entitlements: page.entitlements,
          payment: toPaymentFileState(page.header)
        },
        toEntitlementsHrefs(href, from)
      )
    : null

const toAgreement = ({ page, href, from }: TabInput) =>
  page.agreement
    ? toAgreementTab(page.agreement, {
        version: page.header.version,
        fetchStatus: page.header.files.agreement?.fetchStatus ?? null,
        hrefs: {
          phases: toTabHref(href, 'phases', from),
          payment: toFileTabHref(page.header, 'payment', href, from)
        }
      })
    : null

const toPayment = ({ page, href, from }: TabInput) =>
  page.payment
    ? toPaymentDefinition(page.payment, {
        version: page.header.version,
        hrefs: {
          entitlements: toTabHref(href, 'entitlements', from),
          agreement: toFileTabHref(page.header, 'agreement', href, from)
        }
      })
    : null

const toRaw = ({ page }: TabInput) =>
  page.definition ? JSON.stringify(page.definition, null, 2) : null

/** Each tab's own model, built only on its own tab. */
const tabModels = {
  phases: toPhases,
  questions: toQuestions,
  actions: toActions,
  entitlements: toEntitlements,
  agreement: toAgreement,
  payment: toPayment,
  raw: toRaw
}

type TabModels = {
  [K in keyof typeof tabModels]: ReturnType<(typeof tabModels)[K]> | null
}

const toTabModels = (tab: GrantTabId, input: TabInput): TabModels => {
  const models = Object.fromEntries(
    Object.keys(tabModels).map((id) => [id, null])
  ) as TabModels
  const build = tabModels[tab as keyof typeof tabModels] as
    | ((input: TabInput) => unknown)
    | undefined

  return build ? { ...models, [tab]: build(input) } : models
}

const toOverview = (page: GrantVersionPage, tab: GrantTabId, href: string) =>
  tab === 'overview'
    ? {
        event: toVersionEvent(page.events, 'GAS', href),
        files: toFileRows(page.header)
      }
    : { event: null, files: null }

export const toGrantPage = (
  page: GrantVersionPage,
  tab: GrantTabId,
  from: string,
  { notice, query, times }: GrantPageOptions
): GrantPageModel => {
  const href = toGrantHref(page.header)
  const tabs = toVersionTabs(page.header)

  return {
    ...toVersionShell({
      kind: 'grant',
      record: grantType,
      header: page.header,
      tabs,
      tab: tabs.find(({ id }) => id === tab) ?? tabs[0],
      from,
      sectionErrors: page.sectionErrors,
      notice,
      times,
      extraAlerts:
        tab === 'overview' && hasNoAdminRole(page) ? [noAdminRole] : []
    }),
    ...toOverview(page, tab, toTabHref(href, 'overview', from)),
    ...toTabModels(tab, { page, href, from, query })
  }
}
