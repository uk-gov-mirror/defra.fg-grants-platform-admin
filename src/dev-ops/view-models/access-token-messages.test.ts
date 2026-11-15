import {
  deletedToast,
  toExpiryToast,
  toNoticeFor,
  toRefusal,
  toRefusalToast,
  toRevokedToast,
  toUnavailableAlert,
  toUnknownAlert
} from './access-token-messages.ts'

const refused = (statusCode: number, errorCode: string | null) =>
  ({ outcome: 'refused', statusCode, errorCode }) as const

const unknown = { outcome: 'unknown' } as const
const errored = { outcome: 'errored' } as const

describe('the toasts a write leaves', () => {
  test('revoke names the token by its hint', () => {
    expect(toRevokedToast('0c4a')).toEqual({
      tone: 'success',
      text: 'Token …0c4a revoked'
    })
    expect(toRevokedToast(null).text).toBe('Token revoked')
  })

  test('expiry names the new day, or never', () => {
    expect(toExpiryToast('2027-02-04T23:59:59.000Z')).toEqual({
      tone: 'success',
      text: 'Expiry changed to 4 Feb 2027'
    })
    expect(toExpiryToast(null).text).toBe('Expiry changed to never')
  })

  test('delete is info', () => {
    expect(deletedToast).toEqual({ tone: 'info', text: 'Token record deleted' })
  })
})

describe('toUnknownAlert', () => {
  test('revoke says what to check before trying again', () => {
    expect(toUnknownAlert('revoke', 'gas', unknown)).toEqual({
      tone: 'warning',
      title: 'Revoke status unknown.',
      text: 'GAS didn’t answer in time. Refresh to see whether the token was revoked before trying again.'
    })
  })

  test('on CW, GAS sending nothing names GAS, not CW', () => {
    expect(
      toUnknownAlert('revoke', 'cw', { outcome: 'unknown', gasSilent: true })
        .text
    ).toBe(
      'GAS didn’t answer in time. Refresh to see whether the token was revoked before trying again.'
    )
  })

  test.each(['gas', 'cw'] as const)(
    'on %s, an error GAS answered with says so, naming GAS',
    (service) => {
      expect(toUnknownAlert('revoke', service, errored)).toEqual({
        tone: 'warning',
        title: 'Revoke status unknown.',
        text: 'GAS answered with an error. Refresh to see whether the token was revoked before trying again.'
      })
    }
  )

  test.each(['issue', 'rotate'] as const)(
    '%s adds that an issued token must be revoked, its value being gone',
    (action) => {
      expect(toUnknownAlert(action, 'cw', unknown).text).toMatch(
        /^CW didn’t answer in time\. .* If a token was issued, revoke it: its value can’t be shown again\.$/
      )
    }
  )

  test.each([
    ['expiry', 'Expiry change status unknown.'],
    ['delete', 'Delete status unknown.'],
    ['issue', 'New token status unknown.'],
    ['rotate', 'Rotation status unknown.']
  ] as const)('%s has its own title', (action, title) => {
    expect(toUnknownAlert(action, 'gas', unknown).title).toBe(title)
  })
})

describe('toRefusal', () => {
  test.each([
    [
      'rotate',
      refused(409, 'API_TOKEN_NOT_ACTIVE'),
      'Not rotated.',
      'This token is no longer active. Nothing has changed.'
    ],
    [
      'rotate',
      refused(409, 'API_TOKEN_DUPLICATE'),
      'Not rotated.',
      'The new token matched one already stored. Try again for a fresh one. Nothing has changed.'
    ],
    [
      'rotate',
      refused(409, 'API_TOKEN_IN_USE'),
      'Not rotated.',
      'Dev Ops is calling GAS with this token. Keep the old one valid until the new one is deployed. Nothing has changed.'
    ],
    [
      'expiry',
      refused(409, 'API_TOKEN_NOT_ACTIVE'),
      'Expiry not changed.',
      'The token changed while this was open. Refresh and try again. Nothing has changed.'
    ],
    [
      'expiry',
      refused(409, 'API_TOKEN_IN_USE'),
      'Expiry not changed.',
      'Dev Ops is calling GAS with this token. Its expiry has to stay in the future. Nothing has changed.'
    ],
    [
      'revoke',
      refused(409, 'API_TOKEN_IN_USE'),
      'Not revoked.',
      'Dev Ops is calling GAS with this token. Rotate it instead. Nothing has changed.'
    ],
    [
      'delete',
      refused(409, 'API_TOKEN_ACTIVE'),
      'Not deleted.',
      'Only a revoked or expired token can be deleted. Nothing has changed.'
    ],
    [
      'revoke',
      refused(404, 'API_TOKEN_NOT_FOUND'),
      'Not revoked.',
      'GAS no longer has this token. Nothing has changed.'
    ],
    [
      'rotate',
      refused(404, 'API_CLIENT_NOT_FOUND'),
      'Not rotated.',
      'GAS no longer has this token. Nothing has changed.'
    ],
    [
      'revoke',
      refused(404, 'SOMETHING_ELSE'),
      'Not revoked.',
      'GAS refused the request. Nothing has changed.'
    ],
    [
      'revoke',
      { outcome: 'not-offered' },
      'Not revoked.',
      'GAS doesn’t offer access tokens. Nothing has changed.'
    ],
    [
      'issue',
      { outcome: 'not-offered' },
      'Not issued.',
      'GAS doesn’t offer access tokens. Nothing has changed.'
    ],
    [
      'delete',
      refused(400, 'SOMETHING_ELSE'),
      'Not deleted.',
      'GAS refused the request. Nothing has changed.'
    ],
    [
      'expiry',
      { outcome: 'unreachable' },
      'Expiry not changed.',
      'GAS couldn’t be reached. Nothing has changed.'
    ],
    [
      'issue',
      { outcome: 'unchecked' },
      'Not issued.',
      'GAS couldn’t list the tokens to check this client. Nothing has changed.'
    ]
  ] as const)('%s, %j: %s %s', (action, failure, title, text) => {
    expect(toRefusal(action, failure, 'gas')).toEqual({ title, text })
  })

  test('on CW, the service named is CW, and the in-use caller GAS', () => {
    expect(
      toRefusal('revoke', refused(409, 'API_TOKEN_IN_USE'), 'cw').text
    ).toBe(
      'GAS is calling CW with this token. Rotate it instead. Nothing has changed.'
    )
    expect(
      toRefusal('delete', refused(404, 'API_TOKEN_NOT_FOUND'), 'cw').text
    ).toBe('CW no longer has this token. Nothing has changed.')
  })

  test('on CW, a GAS with no token routes is named as GAS', () => {
    expect(toRefusal('delete', { outcome: 'not-offered' }, 'cw').text).toBe(
      'GAS doesn’t offer access tokens. Nothing has changed.'
    )
  })

  test('a write never sent names GAS, unless GAS said it couldn’t reach CW', () => {
    expect(toRefusal('revoke', { outcome: 'unreachable' }, 'cw').text).toBe(
      'GAS couldn’t be reached. Nothing has changed.'
    )
    expect(
      toRefusal(
        'revoke',
        { outcome: 'unreachable', errorCode: 'CW_UNREACHABLE' },
        'cw'
      ).text
    ).toBe('CW couldn’t be reached. Nothing has changed.')
  })

  test('as a toast, for a token the list no longer has', () => {
    expect(
      toRefusalToast({
        title: 'Not revoked.',
        text: 'GAS no longer has this token. Nothing has changed.'
      })
    ).toEqual({
      tone: 'danger',
      text: 'Not revoked. GAS no longer has this token. Nothing has changed.'
    })
  })
})

describe('toUnavailableAlert', () => {
  test.each([
    [
      'gas',
      { outcome: 'unknown' },
      'GAS didn’t answer in time. Nothing has changed — try again in a moment.'
    ],
    [
      'cw',
      { outcome: 'unknown' },
      'CW didn’t answer in time. Nothing has changed — try again in a moment.'
    ],
    [
      'cw',
      { outcome: 'unknown', gasSilent: true },
      'GAS didn’t answer in time. Nothing has changed — try again in a moment.'
    ],
    [
      'cw',
      { outcome: 'unreachable' },
      'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
    ],
    [
      'cw',
      { outcome: 'unreachable', errorCode: 'CW_UNREACHABLE' },
      'CW couldn’t be reached. Nothing has changed — try again in a moment.'
    ],
    [
      'gas',
      { outcome: 'refused', statusCode: 403, errorCode: null },
      'GAS refused the request. Nothing has changed.'
    ],
    [
      'gas',
      errored,
      'GAS answered with an error. Nothing has changed — try again in a moment; if it keeps failing, check GAS’s logs.'
    ],
    [
      'cw',
      errored,
      'GAS answered with an error. Nothing has changed — try again in a moment; if it keeps failing, check GAS’s logs.'
    ]
  ] as const)('on %s, %j: %s', (service, failure, text) => {
    expect(toUnavailableAlert(failure, service)).toEqual({
      tone: 'danger',
      title: 'The tokens list couldn’t be loaded.',
      text,
      retry: true
    })
  })

  test.each(['gas', 'cw'] as const)(
    'on %s, a GAS with no token routes is a warning with nothing to retry',
    (service) => {
      expect(toUnavailableAlert({ outcome: 'not-offered' }, service)).toEqual({
        tone: 'warning',
        title: 'This GAS doesn’t offer access tokens.',
        text: 'It’s an older version without the access tokens API. Tokens can be managed here once GAS is upgraded.',
        retry: false
      })
    }
  )
})

describe('toNoticeFor', () => {
  test('keeps a notice for its own service’s page only', () => {
    const notice = { service: 'cw' as const, toast: deletedToast }

    expect(toNoticeFor(notice, 'cw')).toBe(notice)
    expect(toNoticeFor(notice, 'gas')).toBeNull()
    expect(toNoticeFor(undefined, 'gas')).toBeNull()
  })
})
