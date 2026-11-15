// How CW builds a case view and calls its external actions at runtime, for the Pages and Integrations tabs.
import type {
  ServiceAddress,
  StoredCaseTab,
  StoredCaseView,
  StoredEndpoint,
  StoredExternalAction,
  StoredWorkflow,
  WorkflowDefinition
} from '../use-cases/get-workflow-page.use-case.ts'

export const findExternalAction = (
  { externalActions }: StoredWorkflow,
  code: unknown
): StoredExternalAction | null =>
  typeof code === 'string'
    ? (externalActions?.find((action) => action.code === code) ?? null)
    : null

export const endpointCodeOf = ({
  endpoint
}: StoredExternalAction): string | null =>
  typeof endpoint === 'object' && endpoint?.code ? endpoint.code : null

export const findEndpoint = (
  { endpoints }: StoredWorkflow,
  action: StoredExternalAction
): StoredEndpoint | null => {
  const code = endpointCodeOf(action)

  return code === null
    ? null
    : (endpoints?.find((endpoint) => endpoint.code === code) ?? null)
}

export type ActionCall =
  | { kind: 'not-defined'; code: string }
  | { kind: 'no-endpoint'; action: StoredExternalAction }
  | {
      kind: 'call'
      action: StoredExternalAction
      endpoint: StoredEndpoint
      address: ServiceAddress
    }

const toNotDefined = (code: unknown): ActionCall => ({
  kind: 'not-defined',
  code: typeof code === 'string' ? code : JSON.stringify(code)
})

export const addressOf = (
  { workflow, addresses }: WorkflowDefinition,
  endpoint: StoredEndpoint
): ServiceAddress => addresses[(workflow.endpoints ?? []).indexOf(endpoint)]

/** What CW would call for an action code; a code that is not a string is shown as stored. */
export const toActionCall = (
  definition: WorkflowDefinition,
  code: unknown
): ActionCall => {
  const action = findExternalAction(definition.workflow, code)

  return action === null ? toNotDefined(code) : toCall(definition, action)
}

export const toCall = (
  definition: WorkflowDefinition,
  action: StoredExternalAction
): ActionCall => {
  const endpoint = findEndpoint(definition.workflow, action)

  return endpoint === null
    ? { kind: 'no-endpoint', action }
    : {
        kind: 'call',
        action,
        endpoint,
        address: addressOf(definition, endpoint)
      }
}

export const caseViewOf = ({ pages = {} }: StoredWorkflow): StoredCaseView =>
  pages.cases?.details ?? {}

/** CW adds the shown actions to the case banner, and only when there is one. */
export const toBannerButtons = (
  workflow: StoredWorkflow
): StoredExternalAction[] =>
  caseViewOf(workflow).banner
    ? (workflow.externalActions ?? []).filter(({ display }) => display === true)
    : []

export interface CaseTab {
  key: string
  label: string
  builtIn: boolean
  /** Null when the tab is always shown. */
  renderIf: string | null
  /** The tab's action map, in map order. */
  fires: { key: string; actionCode: unknown }[]
  components: string[]
  /** Where the workflow points the tab's link, the tab itself included; a null address is worked out from the case. */
  customLink: { address: string | null } | null
}

interface BuiltInTab {
  key: string
  label: string
  index: number
  /** CW loads the tab through its tab route, which fires its actions. */
  loadsAsTab: boolean
}

const builtInTabs: BuiltInTab[] = [
  { key: 'tasks', label: 'Tasks', index: 0, loadsAsTab: false },
  { key: 'case-details', label: 'Application', index: 1, loadsAsTab: true },
  { key: 'notes', label: 'Notes', index: 4, loadsAsTab: false },
  { key: 'timeline', label: 'Timeline', index: 3, loadsAsTab: false }
]

const builtInKeys = new Set(builtInTabs.map(({ key }) => key))

const idToText = (key: string): string =>
  key
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

/** How CW's resolver reads a string: as written, from the case, or worked out by JSONata. */
export type ValueSource = 'fixed' | 'case' | 'computed'

const isRef = (part: string): boolean =>
  part.startsWith('$.') || part.startsWith('@.')

const isEscapedRef = (value: string): boolean =>
  value.startsWith('\\$.') || value.startsWith('\\@.')

/** An escaped ref is sent as written, without its backslash. */
export const literalOf = (value: string): string =>
  isEscapedRef(value) ? value.slice(1) : value

/** In CW's order: an escaped ref, then `jsonata:`, then a ref alone or among space-separated words. */
export const sourceOfText = (value: string): ValueSource => {
  if (isEscapedRef(value)) {
    return 'fixed'
  }

  if (value.startsWith('jsonata:')) {
    return 'computed'
  }

  return value.split(' ').some(isRef) ? 'case' : 'fixed'
}

/** Scheme, host and path only: never credentials, a query or a fragment. */
const toShownAddress = (url: string): string =>
  url
    .replace(/^((?:[a-z][a-z0-9+.-]*:)?\/\/)[^/?#]*@/i, '$1')
    .replace(/[?#].*$/s, '')

const fixedAddressOf = (template: unknown): string | null =>
  typeof template === 'string' && sourceOfText(template) === 'fixed'
    ? toShownAddress(literalOf(template))
    : null

/** CW sends the tab's link to `href.urlTemplate` whenever one is set. */
const toCustomLink = (link: StoredCaseTab['link']): CaseTab['customLink'] => {
  const template = link?.href?.urlTemplate

  return template ? { address: fixedAddressOf(template) } : null
}

const toFires = ({ action }: StoredCaseTab = {}): CaseTab['fires'] =>
  Object.entries(action ?? {}).map(([key, actionCode]) => ({
    key,
    actionCode
  }))

const toComponents = ({ content }: StoredCaseTab = {}): string[] =>
  (content ?? []).map(({ component }) => component ?? 'text')

type IndexedTab = CaseTab & { index: number | undefined }

/** A built-in keeps its own label and place; only Application's actions and content count. */
const toBuiltInTab = (
  { key, label, index }: BuiltInTab,
  tab: StoredCaseTab | undefined
): IndexedTab => ({
  key,
  label,
  index,
  builtIn: true,
  renderIf: null,
  fires: toFires(tab),
  components: toComponents(tab),
  customLink: null
})

const toLink = (
  key: string,
  { text, index }: NonNullable<StoredCaseTab['link']>
): Pick<IndexedTab, 'label' | 'index'> => ({
  label: text || idToText(key),
  index
})

const toDefinitionTab = (
  key: string,
  { link, renderIf, ...tab }: StoredCaseTab
): IndexedTab => ({
  key,
  ...toLink(key, link ?? {}),
  builtIn: false,
  renderIf: renderIf ?? null,
  fires: toFires(tab),
  components: toComponents(tab),
  customLink: toCustomLink(link)
})

/** CW's own comparator: a tab with no index goes last, ties keep their order. */
const sortIndexOf = ({ index }: IndexedTab): number =>
  index ?? Number.MAX_SAFE_INTEGER

export const toCaseTabs = (workflow: StoredWorkflow): CaseTab[] => {
  const { tabs = {} } = caseViewOf(workflow)

  const builtIns = builtInTabs.map((builtIn) =>
    toBuiltInTab(builtIn, builtIn.loadsAsTab ? tabs[builtIn.key] : {})
  )

  const definitionTabs = Object.entries(tabs)
    .filter(([key]) => !builtInKeys.has(key))
    .map(([key, tab]) => toDefinitionTab(key, tab))

  return [...builtIns, ...definitionTabs]
    .sort((a, b) => sortIndexOf(a) - sortIndexOf(b))
    .map(({ index: _index, ...tab }) => tab)
}

/** What a call cell shows: CW's resolved address, or the endpoint's path when CW has no usable URL for its service. */
export type CallCell =
  | { kind: 'not-defined'; code: string }
  | { kind: 'no-endpoint' }
  | {
      kind: 'call'
      method: string
      url: string
      service: string | null
      hasUrl: boolean
    }

const toCalled = ({
  endpoint,
  address
}: Extract<ActionCall, { kind: 'call' }>): CallCell => ({
  kind: 'call',
  method: endpoint.method,
  url: address.url ?? endpoint.path,
  service: address.service ?? endpoint.service,
  hasUrl: address.url !== null
})

export const toCallCell = (call: ActionCall): CallCell => {
  if (call.kind === 'call') {
    return toCalled(call)
  }

  return call.kind === 'not-defined'
    ? { kind: 'not-defined', code: call.code }
    : { kind: 'no-endpoint' }
}
