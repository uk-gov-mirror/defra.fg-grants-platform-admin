import type { CaseRef } from '../use-cases/get-case-page.use-case.ts'
import { recordTabEntries } from './record-type.ts'
import type { RecordType } from './record-type.ts'

const casesPath = '/dev-ops/cases'

export const caseType: RecordType = {
  listId: 'cases',
  itemId: 'case',
  title: 'Case',
  path: casesPath,
  source: 'CW',
  linkLabel: 'View case',
  tabs: recordTabEntries,
  view: 'case',
  titleParam: 'caseRef'
}

export const toCaseHref = ({ workflowCode, caseRef }: CaseRef): string =>
  `${casesPath}/${encodeURIComponent(workflowCode)}/${encodeURIComponent(caseRef)}`
