import { toFileRows, toLocation, toStoredDot } from './version-files.ts'

describe('toStoredDot', () => {
  test.each([
    [{ stored: true, fetchStatus: 'fetched' }, 'Stored', 'success'],
    [{ stored: true, fetchStatus: 'pending' }, 'Stored', 'success'],
    [{ stored: false, fetchStatus: 'pending' }, 'Not stored yet', 'neutral'],
    [
      { stored: false, fetchStatus: 'transient_error' },
      'Fetch error',
      'warning'
    ],
    [{ stored: false, fetchStatus: 'permanent_error' }, 'Failed', 'danger'],
    [{ stored: true, fetchStatus: 'permanent_error' }, 'Failed', 'danger']
  ] as const)('reads %o as %s', (file, text, tone) => {
    expect(toStoredDot(file)).toEqual({ text, tone })
  })
})

describe('toLocation', () => {
  test('joins the bucket and the key', () => {
    expect(
      toLocation(
        { s3Bucket: 'grants-config-dev' },
        {
          stored: true,
          fetchStatus: 'fetched',
          s3Key: 'woodland/1.2.0/grant.json'
        }
      )
    ).toBe('grants-config-dev/woodland/1.2.0/grant.json')
  })

  test.each([
    [{ s3Bucket: null }, { s3Key: 'grant.json' }],
    [{}, { s3Key: 'grant.json' }],
    [{ s3Bucket: 'grants-config-dev' }, { s3Key: null }],
    [{ s3Bucket: 'grants-config-dev' }, {}]
  ])('is unknown without both parts: %o %o', (version, key) => {
    expect(
      toLocation(version, { stored: true, fetchStatus: 'fetched', ...key })
    ).toBeNull()
  })
})

describe('toFileRows', () => {
  test('lists the files the version has, in order, each with where it is and its state', () => {
    expect(
      toFileRows({
        code: 'woodland',
        version: '1.2.0',
        s3Bucket: 'b',
        files: {
          payment: { stored: false, fetchStatus: 'pending', s3Key: 'p.json' },
          grant: { stored: true, fetchStatus: 'fetched', s3Key: 'g.json' }
        }
      })
    ).toEqual([
      {
        type: 'grant',
        name: 'Grant definition',
        location: 'b/g.json',
        stored: { text: 'Stored', tone: 'success' }
      },
      {
        type: 'payment',
        name: 'Payment definition',
        location: 'b/p.json',
        stored: { text: 'Not stored yet', tone: 'neutral' }
      }
    ])
  })
})
