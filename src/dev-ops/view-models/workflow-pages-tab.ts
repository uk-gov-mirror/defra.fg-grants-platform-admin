import type {
  StoredBanner,
  WorkflowDefinition
} from '../use-cases/get-workflow-page.use-case.ts'
import {
  caseViewOf,
  toActionCall,
  toBannerButtons,
  toCall,
  toCallCell,
  toCaseTabs
} from './workflow-external-actions.ts'
import type { CallCell, CaseTab } from './workflow-external-actions.ts'
import { toMappingValue } from './mapping-table.ts'

/**
 * A stored path, as written; an empty one is shown as `""`, so it never reads
 * as missing. CW evaluates every `jsonata:` string (`resolve-json.js`): that
 * is a calculated value, shown without its prefix.
 */
export interface StoredText {
  text: string
  calculated: boolean
}

interface SummaryRow {
  label: string
  /** Null when the row names no value. */
  valueFrom: StoredText | null
  type: string
}

interface CaseTabRow {
  order: number
  label: string
  builtIn: boolean
  /** Where the workflow points the tab's link: a path, or worked out from the case; null when CW's own. */
  link: { address: string | null } | null
  /** Null when the tab is always shown. */
  shownWhen: StoredText | null
  calls: CallCell[]
  components: string[]
}

export interface WorkflowPagesTab {
  banner: {
    heading: StoredText | null
    buttons: { name: string; call: CallCell }[]
    summary: SummaryRow[]
  }
  tabs: CaseTabRow[]
}

const toStoredText = (text: string | undefined): StoredText | null => {
  if (text === undefined) {
    return null
  }

  const value = toMappingValue(text)

  return {
    text: value.empty ? '""' : value.text,
    calculated: value.kind === 'expression'
  }
}

const toSummary = ({ summary = {} }: StoredBanner = {}): SummaryRow[] =>
  Object.values(summary).map(({ label, text, type, format }) => ({
    label,
    valueFrom: toStoredText(text),
    type: format ? `${type} (${format})` : type
  }))

const toCaseTabRow =
  (definition: WorkflowDefinition) =>
  (
    { label, builtIn, renderIf, fires, components, customLink }: CaseTab,
    index: number
  ): CaseTabRow => ({
    order: index + 1,
    label,
    builtIn,
    link: customLink,
    shownWhen: renderIf ? toStoredText(renderIf) : null,
    calls: fires.map(({ actionCode }) =>
      toCallCell(toActionCall(definition, actionCode))
    ),
    components
  })

/** The case view CW builds from this workflow: its banner, then its tabs in order. */
export const toWorkflowPagesTab = (
  definition: WorkflowDefinition
): WorkflowPagesTab => {
  const { workflow } = definition
  const { banner } = caseViewOf(workflow)

  return {
    banner: {
      heading: toStoredText(banner?.title?.text),
      buttons: toBannerButtons(workflow).map((action) => ({
        name: action.name,
        call: toCallCell(toCall(definition, action))
      })),
      summary: toSummary(banner)
    },
    tabs: toCaseTabs(workflow).map(toCaseTabRow(definition))
  }
}
