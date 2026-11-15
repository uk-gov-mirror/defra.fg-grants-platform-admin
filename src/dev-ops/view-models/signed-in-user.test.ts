import { toInitials, toSignedInUser } from './signed-in-user.ts'

describe('toSignedInUser', () => {
  test('carries the name and the email', () => {
    expect(
      toSignedInUser({ name: ' Ada Lovelace ', email: 'ada@example.gov.uk' })
    ).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.gov.uk',
      initials: 'AL'
    })
  })

  test('writes the name in Title Case', () => {
    expect(
      toSignedInUser({ name: 'LOVELACE ada', email: 'ada@example.gov.uk' })
        ?.name
    ).toBe('Lovelace Ada')
  })

  test('lets the email stand in for a missing name', () => {
    expect(toSignedInUser({ email: 'ada@example.gov.uk' })).toEqual({
      name: 'ada@example.gov.uk',
      email: 'ada@example.gov.uk',
      initials: 'A'
    })
  })

  test.each([
    ['a user with neither', { id: 'c5afd049' }],
    ['fields that are not strings', { name: 42, email: null }],
    ['no user at all', undefined]
  ])('says nobody is signed in given %s', (_name, user) => {
    expect(toSignedInUser(user)).toBeNull()
  })
})

describe('toInitials', () => {
  test.each([
    ['Ada Lovelace', 'AL'],
    ['ada king lovelace', 'AK'],
    ['Ada', 'A']
  ])('reads %s as %s', (name, initials) => {
    expect(toInitials(name)).toBe(initials)
  })
})
