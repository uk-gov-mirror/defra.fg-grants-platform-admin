import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

/**
 * Where Dev Ops' Sign out lands. `auth: false` is the whole of it: a signed
 * out user has no session, and anything that asked for one would send them to
 * Entra ID, which still holds its own and would sign them straight back in.
 */
export const toSignedOutRoute = (path: string): ServerRoute => ({
  method: 'GET',
  path,
  options: { auth: false },
  handler(_request: Request, h: ResponseToolkit) {
    // Back on a shared machine must not bring a list back from the cache.
    return h
      .view('signed-out', { pageTitle: 'Signed out', shellNav: 'none' })
      .header('clear-site-data', '"cache"')
  }
})
