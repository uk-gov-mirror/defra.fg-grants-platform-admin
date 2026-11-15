import type { FetchStatus } from '../repositories/config-versions.ts'
import type {
  AgreementComponent,
  AgreementDefinition,
  EndpointAddress,
  GrantAgreement
} from '../repositories/grants.repository.ts'
import { toValueRows } from './mapping-rows.ts'
import type { ValueRow } from './mapping-rows.ts'
import { toMappingRows, toMappingValue } from './mapping-table.ts'

interface Call {
  method: string
  path: string
  /** Null when GAS has no usable URL for the service here. */
  url: string | null
  service: string
}

export interface EndpointRow extends Call {
  code: string
}

export type AgreementFact = { label: string } & (
  | { kind: 'mono'; text: string }
  | { kind: 'created-when'; href: string }
  | { kind: 'endpoints'; endpoints: EndpointRow[] }
)

interface Rule {
  name: string
  value: string
  message: string | null
}

/** One action of a state, or the state alone when it has none; its name and flags on its first row only. */
export interface StateRow {
  state: string
  flags: string[]
  page: string | null
  action: string | null
  target: string | null
  requires: Rule[]
  runs: { process: string; payment: boolean }[]
}

interface ButtonRow {
  text: string
  action: string
  /** Why the button returns an error, in words; null when it works. */
  problem: string | null
}

export interface PageRow {
  id: string
  title: string
  /** What the customer sees beyond the title, in words. */
  shows: string
  buttons: ButtonRow[]
}

interface ProcessRow {
  name: string
  type: string
  requestsPayment: boolean
  call: Call | null
  outputs: ValueRow[]
}

/** A definition GAS cannot load gives its problem and nothing derived from it. */
export type AgreementTab =
  | {
      problem: string
      /** GAS has marked the file unusable, so it falls back. */
      failed: boolean
      major: string
      version: string
      raw: string
    }
  | {
      problem: null
      major: string
      paymentHref: string | null
      facts: AgreementFact[]
      /** The services GAS has no URL for here, by name. */
      missingServices: string[]
      states: StateRow[]
      pages: PageRow[]
      createdWith: ValueRow[]
      processes: ProcessRow[]
      raw: string
    }

export interface AgreementContext {
  version: string
  /** GAS's own fetch status for the agreement file. */
  fetchStatus: FetchStatus | null
  hrefs: { phases: string; payment: string | null }
}

type States = AgreementDefinition['states']
type State = States[string]
type Transition = NonNullable<State['on']>[string]
type Process = NonNullable<AgreementDefinition['processDefinitions']>[string]

/** GAS keeps an agreement on the definition it was accepted under from here on (`load-agreement-definition.js`). */
const lockedState = 'accepted'

/** GAS's handler that requests the agreement payment. */
const paymentHandler = 'CREATE_AGREEMENT_PAYMENT'

const toApplicationData = (application: unknown): string =>
  typeof application === 'string'
    ? application
    : (JSON.stringify(application) ?? '')

const toTemplateCodes = (
  templates: AgreementDefinition['templates']
): string[] =>
  Object.entries(templates ?? {}).flatMap(([group, keys]) =>
    Object.keys(keys).map((key) => `${group}.${key}`)
  )

const toEndpointRows = (
  { endpoints = [] }: AgreementDefinition,
  addresses: EndpointAddress[] | undefined
): EndpointRow[] =>
  endpoints.map(({ code, method, path, service }) => ({
    code,
    method,
    path,
    service,
    url: addresses?.find((address) => address.code === code)?.url ?? null
  }))

const toEndpointsFacts = (endpoints: EndpointRow[]): AgreementFact[] =>
  endpoints.length ? [{ label: 'Endpoints', kind: 'endpoints', endpoints }] : []

const mono = (label: string, codes: string[]): AgreementFact => ({
  label,
  kind: 'mono',
  text: codes.join(', ')
})

const toFacts = (
  { definition, endpointAddresses }: GrantAgreement,
  { hrefs }: AgreementContext
): AgreementFact[] => [
  mono('Code', [definition.code]),
  mono('Number prefix', [definition.agreementNumberPrefix]),
  mono('Reads answers from', [
    toApplicationData(definition.create.application)
  ]),
  { label: 'Created when', kind: 'created-when', href: hrefs.phases },
  mono('Runs on create', definition.create.processes ?? []),
  mono('Text templates', toTemplateCodes(definition.templates)),
  ...toEndpointsFacts(toEndpointRows(definition, endpointAddresses))
]

/** GAS names each missing variable `{SERVICE}_URL`; the page names the service. */
const toMissingServices = ({ missingServiceUrls = [] }: GrantAgreement) =>
  missingServiceUrls.map((name) => name.replace(/_URL$/, ''))

const listOf = <T>(value: T[] | undefined): T[] => value ?? []

const entriesOf = <T>(value: Record<string, T> | undefined): [string, T][] =>
  Object.entries(value ?? {})

const isNode = (node: unknown): node is Record<string, unknown> =>
  node !== null && typeof node === 'object'

const toRule = ({ name, value, message }: Record<string, unknown>): Rule => ({
  name: String(name),
  value: typeof value === 'string' ? value : JSON.stringify(value),
  message: typeof message === 'string' ? message : null
})

const toRuns = (processes: string[] | undefined) =>
  listOf(processes).map((process) => ({
    process,
    payment: process === paymentHandler
  }))

const toFlags = (name: string, initial: string): string[] => [
  ...(name === initial ? ['initial'] : []),
  ...(name === lockedState ? ['locks version'] : [])
]

const noAction = { action: null, target: null, requires: [], runs: [] }

const toStateRows =
  (initial: string) =>
  ([name, state]: [string, State]): StateRow[] => {
    const actions = entriesOf(state.on).map(([action, move]) => ({
      action,
      target: move.target,
      requires: listOf(move.validation?.required).map(toRule),
      runs: toRuns(move.processes)
    }))

    return (actions.length ? actions : [noAction]).map((row, at) => ({
      state: name,
      flags: at ? [] : toFlags(name, initial),
      page: state.page ?? null,
      ...row
    }))
  }

/** The pages the states show, in state order, then any no state shows. */
const toPageOrder = ({ states, pages }: AgreementDefinition): string[] => {
  const shown = Object.values(states).flatMap((state) => [
    state.page,
    ...Object.values(state.on ?? {}).map(({ page }) => page)
  ])

  return [
    ...new Set(
      [...shown, ...Object.keys(pages)].filter(
        (id): id is string => id !== undefined && Object.hasOwn(pages, id)
      )
    )
  ]
}

const isControl = (node: Record<string, unknown>): boolean =>
  ['button', 'form'].includes(String(node.component)) &&
  typeof node.action === 'string'

/** Each standalone button and form, however deeply its page nests it. */
const toControls = (node: unknown): AgreementComponent[] => {
  if (!isNode(node)) {
    return []
  }

  if (Array.isArray(node)) {
    return node.flatMap(toControls)
  }

  return isControl(node)
    ? [node as AgreementComponent]
    : Object.values(node).flatMap(toControls)
}

const isButton = (node: Record<string, unknown>): boolean =>
  node.component === 'button' && typeof node.text === 'string'

/** The text of the first button inside a node, the one a form submits with. */
const firstButtonText = (node: unknown): string | null => {
  if (!isNode(node)) {
    return null
  }

  if (isButton(node)) {
    return String(node.text)
  }

  return (
    Object.values(node)
      .map(firstButtonText)
      .find((found) => found !== null) ?? null
  )
}

/** The states a page is shown in: as a state's own page, or as one of its actions' page. */
const statesShowing = (states: States, page: string): [string, State][] =>
  Object.entries(states).filter(
    ([, state]) =>
      state.page === page ||
      Object.values(state.on ?? {}).some((move) => move.page === page)
  )

/** A standalone button opens its action's page, so an action with none fails (`prepare-agreement-action.use-case.js`). */
const needsPage = (
  control: AgreementComponent,
  transition: Transition
): boolean => control.component === 'button' && !transition.page

const controlNoun = ({ component }: AgreementComponent): string =>
  component === 'form' ? 'form' : 'button'

const toProblem = (
  control: AgreementComponent,
  transition: Transition | undefined,
  showing: string[]
): string | null => {
  const action = String(control.action)

  if (!transition) {
    return showing.length
      ? `${action} is not an action of ${showing.join(', ')}: this ${controlNoun(control)} returns an error`
      : null
  }

  return needsPage(control, transition)
    ? `${action} has no page: this button returns an error`
    : null
}

const toControlText = (control: AgreementComponent, action: string): string =>
  control.component === 'form'
    ? (firstButtonText(control.components) ?? action)
    : String(control.text ?? action)

const toButtonRows = (
  { states }: AgreementDefinition,
  id: string,
  page: Page
): ButtonRow[] => {
  const showing = statesShowing(states, id)
  const moves = Object.fromEntries(
    showing.flatMap(([, state]) => entriesOf(state.on))
  )
  const names = showing.map(([name]) => name)

  return toControls([page.components, page.sections]).map((control) => {
    const action = String(control.action)

    return {
      text: toControlText(control, action),
      action,
      problem: toProblem(control, moves[action], names)
    }
  })
}

const urlTemplateOf = (href: unknown): string | null => {
  const template = isNode(href) ? href.urlTemplate : undefined

  return typeof template === 'string' ? template : null
}

const toBackLink = (
  backLink: { href?: unknown } | undefined
): string | null => {
  const href = backLink?.href

  return typeof href === 'string' ? href : urlTemplateOf(href)
}

type Page = AgreementDefinition['pages'][string]

const when = (shown: boolean, text: string): string[] => (shown ? [text] : [])

const toBackText = (page: Page): string[] => {
  const href = toBackLink(page.backLink)

  return href === null ? [] : [`back link to ${href}`]
}

const toSectionText = ({
  id,
  condition
}: NonNullable<Page['sections']>[number]): string =>
  condition === undefined
    ? id
    : `${id} (shown when ${toMappingValue(condition).text})`

/** Layout, watermarks and the rest, then the sections and the components, as one line. */
const toShows = (page: Page): string =>
  [
    ...(page.layout ? [`${page.layout} layout`] : []),
    ...entriesOf(page.watermarks).map(
      ([state, text]) => `${text} watermark when ${state}`
    ),
    ...when(page.print === true, 'printable'),
    ...when(page.contents === true, 'contents list'),
    ...toBackText(page),
    ...listOf(page.sections).map(toSectionText),
    ...new Set(page.components.map(({ component }) => component))
  ].join(', ')

const toPageRow =
  (definition: AgreementDefinition) =>
  (id: string): PageRow => {
    const page = definition.pages[id]

    return {
      id,
      title: page.title,
      shows: toShows(page),
      buttons: toButtonRows(definition, id, page)
    }
  }

const toCall = (
  name: string,
  process: Process,
  { addresses }: GrantAgreement
): Call | null => {
  if (process.type !== 'endpoint') {
    return null
  }

  const address = addresses.find((candidate) => candidate.process === name)

  return { ...process.endpoint, url: address?.url ?? null }
}

const processTypes: Record<string, string> = {
  endpoint: 'HTTP call',
  handler: 'Built into GAS'
}

const outputsOf = (process: Process): Record<string, unknown> =>
  process.type === 'endpoint' ? (process.output ?? {}) : {}

const toProcessRow =
  (agreement: GrantAgreement) =>
  ([name, process]: [string, Process]): ProcessRow => ({
    name,
    type: processTypes[process.type] ?? process.type,
    requestsPayment: name === paymentHandler,
    call: toCall(name, process, agreement),
    outputs: toValueRows(toMappingRows(outputsOf(process)))
  })

const majorOf = (version: string): string => version.split('.')[0]

const toLoadable = (
  agreement: GrantAgreement,
  context: AgreementContext,
  raw: string
): AgreementTab => {
  const { definition } = agreement

  return {
    problem: null,
    major: majorOf(context.version),
    paymentHref: context.hrefs.payment,
    facts: toFacts(agreement, context),
    missingServices: toMissingServices(agreement),
    states: Object.entries(definition.states).flatMap(
      toStateRows(definition.create.target)
    ),
    pages: toPageOrder(definition).map(toPageRow(definition)),
    createdWith: toValueRows(toMappingRows(definition.create.values ?? {})),
    processes: Object.entries(definition.processDefinitions ?? {}).map(
      toProcessRow(agreement)
    ),
    raw
  }
}

export const toAgreementTab = (
  agreement: GrantAgreement,
  context: AgreementContext
): AgreementTab => {
  const raw = JSON.stringify(agreement.definition, null, 2)

  return agreement.problem === null
    ? toLoadable(agreement, context, raw)
    : {
        problem: agreement.problem,
        failed: context.fetchStatus === 'permanent_error',
        major: majorOf(context.version),
        version: context.version,
        raw
      }
}
