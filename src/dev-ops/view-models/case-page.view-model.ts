import type {
  CaseOverview,
  CasePage
} from '../use-cases/get-case-page.use-case.ts'
import type { RecordTab } from '../use-cases/record-reads.ts'
import {
  applicationType,
  toApplicationHref
} from './applications-page.view-model.ts'
import { caseType, toCaseHref } from './cases-page.view-model.ts'
import {
  toDateFact,
  toCounterpartFacts,
  toRecordPage,
  toSeriesData,
  toSizeFact,
  toVersionedFact,
  toVersionLinkOf
} from './record-page.view-model.ts'
import type { Fact, RecordPageModel } from './record-page.view-model.ts'
import type { Zone } from './zoned-clock.ts'
import { toWorkflowHref } from './workflows-page.view-model.ts'

const toFacts = (
  overview: CaseOverview,
  applicationHref: string | null,
  workflowHref: string | null,
  zone: Zone
): Fact[][] => [
  [
    toVersionedFact(
      'workflow',
      'Workflow',
      { ...overview, code: overview.workflowCode },
      workflowHref
    ),
    ...toCounterpartFacts(applicationType, applicationHref),
    toDateFact('created', 'Created', overview.createdAt, zone),
    toDateFact('closed-at', 'Closed at', overview.closedAt, zone)
  ],
  [toSizeFact(overview.storedBytes)]
]

const toCounterpartHref = ({ header }: CasePage): string | null =>
  header.counterpart?.exists
    ? toApplicationHref({
        code: header.workflowCode,
        clientRef: header.caseRef
      })
    : null

export const toCasePage = (
  page: CasePage,
  tab: RecordTab,
  from: string,
  zone: Zone,
  now: Date = new Date()
): RecordPageModel =>
  toRecordPage(
    caseType,
    {
      ref: page.header.caseRef,
      href: toCaseHref(page.header),
      position: page.header.position,
      facts: page.overview
        ? toFacts(
            page.overview,
            toCounterpartHref(page),
            toVersionLinkOf(
              toWorkflowHref,
              page.overview.workflowCode,
              page.overview.currentConfigVersion,
              toCaseHref(page.header),
              from
            ),
            zone
          )
        : null,
      series: page.overview
        ? toSeriesData(
            page.overview.series,
            ({ caseRef, ...facts }) => ({ ref: caseRef, ...facts }),
            (caseRef) =>
              toCaseHref({ workflowCode: page.header.workflowCode, caseRef })
          )
        : null,
      events: page.events,
      raw: page.raw,
      sourceErrors: page.sourceErrors,
      sectionErrors: page.sectionErrors
    },
    tab,
    zone,
    from,
    now
  )
