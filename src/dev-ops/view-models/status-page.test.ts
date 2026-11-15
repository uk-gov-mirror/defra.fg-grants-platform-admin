import { config } from '../../common/config.ts'
import { toRefererBack, toStatusPage, toStatusState } from './status-page.ts'

const origin = () => new URL(config.get('auth.appBaseUrl')).origin

describe('toStatusState', () => {
  test.each([
    [400, 'Bad Request', 'bad-request'],
    [404, 'Not Found', 'not-found'],
    [403, 'Insufficient scope', 'no-role'],
    [403, 'Cross-origin write refused', 'refused'],
    [500, 'An internal server error occurred', 'error'],
    [503, 'Could not refresh the session', 'error'],
    [413, 'Payload content length greater than maximum allowed', 'error']
  ])('reads %i "%s" as %s', (code, message, state) => {
    expect(toStatusState(code, message)).toBe(state)
  })
})

describe('toRefererBack', () => {
  test.each([
    [
      'a Dev Ops page',
      () => `${origin()}/dev-ops/clients/gas?x=1`,
      '/dev-ops/clients/gas?x=1'
    ],
    ['another site', () => 'https://example.com/dev-ops/clients/gas', null],
    ['a page of this app outside Dev Ops', () => `${origin()}/grant-ops`, null],
    ['nothing', () => undefined, null],
    ['something that is no address', () => 'not a url', null]
  ])('goes back to %s as %s', (_name, referer, back) => {
    expect(toRefererBack(referer())).toBe(back)
  })
})

describe('toStatusPage', () => {
  const request = (method: string, referer?: string) => ({
    method,
    url: new URL('https://gpa.example/dev-ops/applications/a/b?tab=raw'),
    headers: referer ? { referer } : {},
    getTraceId: () => '4bf92f3577b34da6a3ce929d0e0e4736'
  })

  test('tries a read again at its own address, quoting the request’s id', () => {
    expect(toStatusPage(request('get'), 500, 'error')).toEqual({
      state: 'error',
      statusCode: 500,
      pageTitle: 'Something went wrong',
      emptySidebar: false,
      backHref: null,
      retryHref: '/dev-ops/applications/a/b?tab=raw',
      reference: '4bf92f3577b34da6a3ce929d0e0e4736'
    })
  })

  test('tries a write again from the page it was sent from', () => {
    const page = toStatusPage(
      request('post', `${origin()}/dev-ops/clients/cw`),
      500,
      'error'
    )

    expect(page.retryHref).toBe('/dev-ops/clients/cw')
    expect(page.backHref).toBe('/dev-ops/clients/cw')
  })

  test('quotes a reference only where something went wrong', () => {
    expect(toStatusPage(request('get'), 404, 'not-found').reference).toBeNull()
  })

  test('empties the sidebar only for someone without the role', () => {
    expect(toStatusPage(request('get'), 403, 'no-role').emptySidebar).toBe(true)
    expect(toStatusPage(request('get'), 403, 'refused').emptySidebar).toBe(
      false
    )
  })
})
