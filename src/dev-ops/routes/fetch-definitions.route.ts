import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { toActor } from '../../common/view-models/actor.ts'
import type {
  DefinitionFetchResult,
  VersionRef
} from '../use-cases/definition-fetches.ts'
import { fetchGrantDefinitionsUseCase } from '../use-cases/fetch-grant-definitions.use-case.ts'
import { fetchWorkflowDefinitionUseCase } from '../use-cases/fetch-workflow-definition.use-case.ts'
import { definitionFetchNoticeKey } from '../view-models/definition-fetch.ts'
import type { DefinitionFetchFlash } from '../view-models/definition-fetch.ts'
import { toSafeFrom } from '../view-models/event-page.view-model.ts'
import { grantType } from '../view-models/grants-page.view-model.ts'
import {
  backSchema,
  recordParamsSchema,
  recordTabSchema,
  slugFilterSchema,
  versionSchema,
  workflowCodeSchema
} from '../view-models/record-filters.ts'
import { toTabHref } from '../view-models/record-page.view-model.ts'
import type { RecordType } from '../view-models/record-type.ts'
import { seeOther } from '../view-models/see-other.ts'
import { toVersionPath } from '../view-models/record-type.ts'
import { workflowType } from '../view-models/workflows-page.view-model.ts'

/** A Fetch posted from a page loaded before its Events tab went lands on Overview. */
const retiredTabs = ['events']

interface FetchDefinitionsRoute {
  record: RecordType
  params: Record<keyof VersionRef, Joi.Schema>
  fetch: (ref: VersionRef, actor?: string) => Promise<DefinitionFetchResult>
}

/**
 * Fetches every definition file of one version that is not stored, then goes
 * back to the tab it was asked from, with the outcome riding the session for
 * one render.
 */
export const fetchDefinitionsRoute = ({
  record,
  params,
  fetch
}: FetchDefinitionsRoute): ServerRoute => ({
  method: 'POST',
  path: `${record.path}/{code}/{version}/fetch`,
  options: {
    validate: {
      params: recordParamsSchema(params),
      // A body-less POST is `null`, which a Joi `default` alone would refuse.
      payload: Joi.object({
        back: backSchema.default(''),
        tab: recordTabSchema(record)
          .valid(...retiredTabs)
          .default('overview')
      })
        .empty(null)
        .default({})
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { code, version } = request.params
    const ref = { code, version }
    const { back, tab: asked } = request.payload as {
      back: string
      tab: string
    }
    const tab = retiredTabs.includes(asked) ? 'overview' : asked
    const page = toVersionPath(record, ref)
    const result = await fetch(ref, toActor(request))
    const notice: DefinitionFetchFlash = { ...result, page }

    request.yar.flash(definitionFetchNoticeKey, notice)

    return h.redirect(toTabHref(page, tab, toSafeFrom(back))).code(seeOther)
  }
})

export const fetchGrantDefinitionsRoute = fetchDefinitionsRoute({
  record: grantType,
  params: { code: slugFilterSchema, version: versionSchema },
  fetch: fetchGrantDefinitionsUseCase
})

export const fetchWorkflowDefinitionRoute = fetchDefinitionsRoute({
  record: workflowType,
  params: { code: workflowCodeSchema, version: versionSchema },
  fetch: fetchWorkflowDefinitionUseCase
})
