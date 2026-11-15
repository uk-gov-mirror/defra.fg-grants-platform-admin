import type { Boom } from '@hapi/boom'
import type { Request, ResponseToolkit } from '@hapi/hapi'

import { statusCodes } from '../common/status-codes.ts'

import { toStatusPage, toStatusState } from './view-models/status-page.ts'

/** Interpolated, as CDP drops the context object. */
const logError = (request: Request, response: Boom) => {
  const { statusCode } = response.output

  if (statusCode >= statusCodes.internalServerError) {
    request.logger.error(response.stack)
  } else if (statusCode === statusCodes.forbidden) {
    request.logger.warn(`Refused ${request.path}: ${response.message}`)
  }
}

/**
 * Dev Ops' own pages for an error on one of its routes, drawn in its shell
 * rather than as the GOV.UK pages the rest of the app answers with. It runs
 * before the app's errors plugin, which then finds no error left to draw, so
 * the logging that plugin would have done is done here.
 */
export const toStatusResponse = (request: Request, h: ResponseToolkit) => {
  const { response } = request

  if (!('isBoom' in response) || !response.isBoom) {
    return h.continue
  }

  const { statusCode } = response.output
  const state = toStatusState(statusCode, response.message)

  logError(request, response)

  return h
    .view('status', toStatusPage(request, statusCode, state))
    .code(statusCode)
}
