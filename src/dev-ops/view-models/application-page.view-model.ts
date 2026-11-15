import type {
  ApplicationOverview,
  ApplicationPage
} from '../use-cases/get-application-page.use-case.ts'
import type { RecordTab } from '../use-cases/record-reads.ts'
import {
  applicationType,
  toApplicationHref
} from './applications-page.view-model.ts'
import { caseType, toCaseHref } from './cases-page.view-model.ts'
import { toGrantHref } from './grants-page.view-model.ts'
import {
  toDateFact,
  toCounterpartFacts,
  toMonoFact,
  toRecordPage,
  toSeriesData,
  toSizeFact,
  toVersionedFact,
  toVersionLinkOf
} from './record-page.view-model.ts'
import type { Fact, RecordPageModel } from './record-page.view-model.ts'
import type { Zone } from './zoned-clock.ts'

const toFacts = (
  overview: ApplicationOverview,
  caseHref: string | null,
  grantHref: string | null,
  zone: Zone
): Fact[][] => [
  [
    toVersionedFact('grant', 'Grant', overview, grantHref),
    ...toCounterpartFacts(caseType, caseHref),
    toDateFact('submitted', 'Submitted', overview.submittedAt, zone),
    toDateFact('created', 'Created', overview.createdAt, zone),
    toDateFact('updated', 'Updated', overview.updatedAt, zone)
  ],
  [
    toMonoFact('sbi', 'SBI', overview.identifiers.sbi),
    toMonoFact('frn', 'FRN', overview.identifiers.frn),
    toMonoFact('crn', 'CRN', overview.identifiers.crn),
    toSizeFact(overview.storedBytes)
  ]
]

/** A case's ref and workflow are its application's, by construction. */
const toCounterpartHref = ({ header }: ApplicationPage): string | null =>
  header.counterpart?.exists
    ? toCaseHref({ workflowCode: header.code, caseRef: header.clientRef })
    : null

export const toApplicationPage = (
  page: ApplicationPage,
  tab: RecordTab,
  from: string,
  zone: Zone,
  now: Date = new Date()
): RecordPageModel =>
  toRecordPage(
    applicationType,
    {
      ref: page.header.clientRef,
      href: toApplicationHref(page.header),
      position: page.header.position,
      facts: page.overview
        ? toFacts(
            page.overview,
            toCounterpartHref(page),
            toVersionLinkOf(
              toGrantHref,
              page.overview.code,
              page.overview.currentConfigVersion,
              toApplicationHref(page.header),
              from
            ),
            zone
          )
        : null,
      series: page.overview
        ? toSeriesData(
            page.overview.series,
            ({ clientRef, position, createdAt }) => ({
              ref: clientRef,
              position,
              createdAt,
              closedAt: null
            }),
            (clientRef) =>
              toApplicationHref({ code: page.header.code, clientRef })
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
