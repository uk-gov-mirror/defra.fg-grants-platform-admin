import type { Boom } from '@hapi/boom'
import type { Request, ResponseToolkit, Server } from '@hapi/hapi'

import { insufficientScope, statusCodes } from '../../common/status-codes.ts'

const statusCodeMessages: Record<number, string> = {
  [statusCodes.notFound]: 'Page not found',
  [statusCodes.forbidden]: 'Forbidden',
  [statusCodes.unauthorized]: 'Unauthorized',
  [statusCodes.badRequest]: 'Bad Request'
}

const statusCodeMessage = (statusCode: number) =>
  statusCodeMessages[statusCode] ?? 'Something went wrong'

const renderError = (h: ResponseToolkit, statusCode: number) => {
  const errorMessage = statusCodeMessage(statusCode)

  return h
    .view('error', {
      pageTitle: errorMessage,
      heading: statusCode,
      message: errorMessage
    })
    .code(statusCode)
}

// Names the part, not the service: a user may hold one area's role but not the other's.
const forbiddenHeading = 'You do not have access to this part of the service'

// Interpolated, as CDP drops the context object. Only a missing role gets the
// role page; any other 403 is not about the user's roles.
const refuse = (request: Request, h: ResponseToolkit, response: Boom) => {
  request.logger.warn(`Refused ${request.path}: ${response.message}`)

  if (response.message !== insufficientScope) {
    return renderError(h, statusCodes.forbidden)
  }

  return h
    .view('forbidden', {
      pageTitle: forbiddenHeading,
      heading: forbiddenHeading
    })
    .code(statusCodes.forbidden)
}

export const catchAll = (request: Request, h: ResponseToolkit) => {
  const { response } = request

  if (!('isBoom' in response)) {
    return h.continue
  }

  const statusCode = response.output.statusCode

  if (statusCode >= statusCodes.internalServerError) {
    request.logger.error(response.stack)
  }

  if (statusCode === statusCodes.forbidden) {
    return refuse(request, h, response)
  }

  return renderError(h, statusCode)
}

export const errors = {
  plugin: {
    name: 'errors',
    register(server: Server) {
      server.ext('onPreResponse', catchAll)
    }
  }
}
