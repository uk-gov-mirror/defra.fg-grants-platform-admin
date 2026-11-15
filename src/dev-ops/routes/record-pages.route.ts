import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import type { YarFlashes } from '@hapi/yar'
import Joi from 'joi'
import type { Schema } from 'joi'

import { getApplicationPageUseCase } from '../use-cases/get-application-page.use-case.ts'
import type { ApplicationRef } from '../use-cases/get-application-page.use-case.ts'
import { getCasePageUseCase } from '../use-cases/get-case-page.use-case.ts'
import type { CaseRef } from '../use-cases/get-case-page.use-case.ts'
import {
  readApplicationPositionNames,
  readCasePositionNames,
  withPositionNames
} from '../use-cases/read-position-names.use-case.ts'
import { getGrantPageUseCase } from '../use-cases/get-grant-page.use-case.ts'
import type {
  GrantVersionPage,
  GrantVersionRef
} from '../use-cases/get-grant-page.use-case.ts'
import type { GrantTabId } from '../use-cases/grant-tabs.ts'
import { getGrantVersionsUseCase } from '../use-cases/get-grant-versions.use-case.ts'
import { getWorkflowPageUseCase } from '../use-cases/get-workflow-page.use-case.ts'
import { getWorkflowVersionsUseCase } from '../use-cases/get-workflow-versions.use-case.ts'
import type {
  HiddenTab,
  RecordResult,
  RecordTab
} from '../use-cases/record-reads.ts'
import { toApplicationPage } from '../view-models/application-page.view-model.ts'
import { applicationType } from '../view-models/applications-page.view-model.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import type { Catalogue } from '../use-cases/get-catalogue.use-case.ts'
import { toBackBucket, toListAt } from '../view-models/bucket-nav.ts'
import { toCasePage } from '../view-models/case-page.view-model.ts'
import { caseType } from '../view-models/cases-page.view-model.ts'
import { toSafeFrom } from '../view-models/event-page.view-model.ts'
import { definitionFetchNoticeKey } from '../view-models/definition-fetch.ts'
import type { DefinitionFetchFlash } from '../view-models/definition-fetch.ts'
import { toGrantPage } from '../view-models/grant-page.view-model.ts'
import type {
  GrantPageModel,
  GrantPageQuery
} from '../view-models/grant-page.view-model.ts'
import { grantType } from '../view-models/grants-page.view-model.ts'
import { recordPageCache } from '../view-models/list-filters.ts'
import {
  backSchema,
  recordParamsSchema,
  recordTabSchema,
  slugFilterSchema,
  toBackLabel,
  statusSchema,
  versionSchema,
  workflowCodeSchema
} from '../view-models/record-filters.ts'
import { toTabHref } from '../view-models/record-page.view-model.ts'
import type { RecordType } from '../view-models/record-type.ts'
import { toBackHref } from '../view-models/record-view.ts'
import { toVersionPath } from '../view-models/record-type.ts'
import { toWorkflowPage } from '../view-models/workflow-page.view-model.ts'
import { shellQuery, timesOf, withoutShellKeys } from '../view-models/times.ts'
import type { Times } from '../view-models/times.ts'
import {
  missingStatusCodes,
  toRecordMissing
} from '../view-models/record-missing.ts'
import type { MissingState } from '../view-models/record-missing.ts'
import type { Zone } from '../view-models/zoned-clock.ts'
import { workflowType } from '../view-models/workflows-page.view-model.ts'

interface RecordPageRoute<
  K,
  P,
  T extends string,
  N,
  Q,
  M extends { navActive: string | null }
> {
  record: RecordType
  /** Tabs the page no longer has: an old link to one opens Overview. */
  retiredTabs?: string[]
  /** Each URL param after the record's path, in order, with its schema. */
  params: Record<keyof K & string, Schema>
  /** Query params the record's tabs read, besides `tab` and `back`. */
  query?: Record<keyof Q & string, Schema>
  read: (key: K, tab: T) => Promise<RecordResult<P> | HiddenTab>
  toPage: (
    page: P,
    tab: T,
    from: string,
    options: {
      notice?: N
      query: Q
      catalogue: Catalogue | null
      roles: string[]
      zone: Zone
      times: Times
    }
  ) => M
  /** Where a write leaves its outcome for the one render after it. */
  noticeKey?: keyof YarFlashes
}

type RecordPageQuery<T> = {
  tab: T
  back?: string
} & Record<string, unknown>

/** The list a record's page sits under in the navigation: the one it goes back to. */
const toNavActive = (
  catalogue: Catalogue | null,
  from: string
): string | null => toBackBucket(catalogue, from)?.id ?? null

/** Opened from no list, a record sits under its own. */
const toRecordNav = (
  catalogue: Catalogue | null,
  record: RecordType,
  from: string
): string | null => toNavActive(catalogue, toBackHref(record, from))

/** What the Back link says: where `back` leads, else the record's own list. */
const labelAt = (catalogue: Catalogue | null, href: string): string | null =>
  toListAt(catalogue, href)?.label ?? null

const toRecordBackLabel = (
  catalogue: Catalogue | null,
  record: RecordType,
  from: string
): string =>
  toBackLabel(from, {
    listLabel: labelAt(catalogue, from),
    ownListLabel: labelAt(catalogue, record.path) ?? record.listId
  })

/** Without a list to go back to, a record sits under its own. */
const withNav = <M extends { navActive: string | null }>(
  model: M,
  navActive: string | null
): M => ({ ...model, navActive: navActive ?? model.navActive })

/** Taken before the read, so it is spent on this render whatever the read then says. */
const takeNotice = <N>(
  request: Request,
  key: keyof YarFlashes | undefined
): N | undefined =>
  key ? (request.yar.flash(key) as unknown as N[])[0] : undefined

/** The record's page with the reason in place of the record; with no `back` it goes back to, and sits under, its own list. */
const missingView = (
  request: Request,
  h: ResponseToolkit,
  record: RecordType,
  {
    from,
    catalogue,
    state
  }: { from: string; catalogue: Catalogue | null; state: MissingState }
) => {
  const missing = toRecordMissing(record, request.params, state)

  return h
    .view('record-missing', {
      pageTitle: missing.pageTitle,
      missing,
      backHref: toBackHref(record, from),
      backLabel: toRecordBackLabel(catalogue, record, from),
      retryHref: `${request.url.pathname}${request.url.search}`,
      navActive: toNavActive(catalogue, toBackHref(record, from))
    })
    .code(missingStatusCodes[state])
}

const toMissingState = (outcome: string): MissingState =>
  outcome === 'timed-out' ? 'timed-out' : 'unavailable'

/** `tab` and `back` on every record page, then whatever else its tabs read. */
const toQuerySchema = (
  record: RecordType,
  query: Record<string, Schema> = {},
  retiredTabs: string[] = []
) =>
  Joi.object({
    tab: recordTabSchema(record)
      .valid(...retiredTabs)
      .default('overview'),
    back: backSchema,
    ...query,
    ...shellQuery
  })

/** An old link to a tab the page no longer has opens its Overview, keeping where it goes back to. */
const toRetiredTabRedirect =
  (retiredTabs: string[]) => (request: Request, h: ResponseToolkit) => {
    const { tab, back } = request.query as RecordPageQuery<string>

    return retiredTabs.includes(tab)
      ? h
          .redirect(toTabHref(request.path, 'overview', toSafeFrom(back)))
          .takeover()
      : h.continue
  }

/** Hapi types the credentials scope as either one role or many. */
const rolesOf = (request: Request): string[] =>
  [request.auth.credentials.scope ?? []].flat()

/**
 * One tab of one record per render. A record the service has not got, or
 * could not read, is its page with the reason in place of the record.
 */
const recordPageRoute = <
  K,
  P,
  T extends string,
  N = never,
  Q = object,
  M extends { navActive: string | null } = { navActive: string | null }
>({
  record,
  retiredTabs = [],
  params,
  query,
  read,
  toPage,
  noticeKey
}: RecordPageRoute<K, P, T, N, Q, M>): ServerRoute => ({
  method: 'GET',
  path: [record.path, ...Object.keys(params).map((name) => `{${name}}`)].join(
    '/'
  ),
  options: {
    cache: recordPageCache,
    validate: {
      params: recordParamsSchema(params),
      query: toQuerySchema(record, query, retiredTabs)
    },
    pre: [{ method: toRetiredTabRedirect(retiredTabs) }]
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as K
    const { tab, back, ...extra } = withoutShellKeys(
      request.query as RecordPageQuery<T>
    )
    const from = toSafeFrom(back)
    const notice = takeNotice<N>(request, noticeKey)
    const { outcome, page } = await read(key, tab)

    if (outcome === 'not-found') {
      return missingView(request, h, record, {
        from,
        catalogue: await getCatalogueUseCase(),
        state: 'not-found'
      })
    }

    if (outcome === 'hidden') {
      return h.redirect(toTabHref(request.path, 'overview', from))
    }

    const catalogue = await getCatalogueUseCase()

    if (page === null) {
      return missingView(request, h, record, {
        from,
        catalogue,
        state: toMissingState(outcome)
      })
    }

    const times = timesOf(request)
    const model = toPage(page, tab, from, {
      notice,
      query: extra as Q,
      catalogue,
      roles: rolesOf(request),
      zone: times.zone,
      times
    })

    return h.view(record.view, {
      pageTitle: record.title,
      ...withNav(model, toRecordNav(catalogue, record, from)),
      backLabel: toRecordBackLabel(catalogue, record, from)
    })
  }
})

/** The status a Phases link asked for, carried on to the version it opens. */
const toStatusQuery = (status: unknown): Record<string, string> | undefined =>
  status ? { status: String(status) } : undefined

interface CurrentVersionRoute {
  record: RecordType
  retiredTabs: string[]
  code: Schema
  read: (code: string) => Promise<RecordResult<{ current: string | null }>>
}

/** A code alone opens its current version, on the tab asked for; a code with none is not found. */
const currentVersionRoute = ({
  record,
  retiredTabs,
  code,
  read
}: CurrentVersionRoute): ServerRoute => ({
  method: 'GET',
  path: `${record.path}/{code}`,
  options: {
    cache: recordPageCache,
    validate: {
      params: recordParamsSchema({ code }),
      query: toQuerySchema(record, { status: statusSchema }, retiredTabs)
    },
    pre: [{ method: toRetiredTabRedirect(retiredTabs) }]
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { code: asked } = request.params
    const { tab, back, status } =
      request.query as unknown as RecordPageQuery<string>
    const from = toSafeFrom(back)
    const { outcome, page } = await read(asked)

    if (outcome === 'not-found') {
      throw Boom.notFound()
    }

    if (page === null) {
      return missingView(request, h, record, {
        from,
        catalogue: await getCatalogueUseCase(),
        state: toMissingState(outcome)
      })
    }

    if (page.current === null) {
      throw Boom.notFound()
    }

    return h.redirect(
      toTabHref(
        toVersionPath(record, { code: asked, version: page.current }),
        tab,
        from,
        toStatusQuery(status)
      )
    )
  }
})

export const viewApplicationRoute = recordPageRoute({
  record: applicationType,
  params: { code: slugFilterSchema, clientRef: slugFilterSchema },
  read: async (ref: ApplicationRef, tab: RecordTab) =>
    withPositionNames(
      await getApplicationPageUseCase(ref, tab),
      ({ overview }) =>
        overview
          ? { code: overview.code, version: overview.currentConfigVersion }
          : null,
      readApplicationPositionNames
    ),
  toPage: (page, tab, from, { times, catalogue }) =>
    toApplicationPage(page, tab, { from, times, catalogue })
})

export const viewCaseRoute = recordPageRoute({
  record: caseType,
  params: { workflowCode: slugFilterSchema, caseRef: slugFilterSchema },
  read: async (ref: CaseRef, tab: RecordTab) =>
    withPositionNames(
      await getCasePageUseCase(ref, tab),
      ({ overview }) =>
        overview
          ? {
              code: overview.workflowCode,
              version: overview.currentConfigVersion
            }
          : null,
      readCasePositionNames
    ),
  toPage: (page, tab, from, { times, catalogue }) =>
    toCasePage(page, tab, { from, times, catalogue })
})

export const viewGrantRoute = recordPageRoute<
  GrantVersionRef,
  GrantVersionPage,
  GrantTabId,
  DefinitionFetchFlash,
  GrantPageQuery,
  GrantPageModel
>({
  record: grantType,
  retiredTabs: ['events'],
  params: { code: slugFilterSchema, version: versionSchema },
  query: { status: statusSchema },
  read: getGrantPageUseCase,
  toPage: toGrantPage,
  noticeKey: definitionFetchNoticeKey
})

export const viewCurrentGrantRoute = currentVersionRoute({
  record: grantType,
  retiredTabs: ['events'],
  code: slugFilterSchema,
  read: getGrantVersionsUseCase
})

export const viewWorkflowRoute = recordPageRoute({
  record: workflowType,
  retiredTabs: ['events'],
  params: { code: workflowCodeSchema, version: versionSchema },
  query: { status: statusSchema },
  read: getWorkflowPageUseCase,
  toPage: toWorkflowPage,
  noticeKey: definitionFetchNoticeKey
})

export const viewCurrentWorkflowRoute = currentVersionRoute({
  record: workflowType,
  retiredTabs: ['events'],
  code: workflowCodeSchema,
  read: getWorkflowVersionsUseCase
})
