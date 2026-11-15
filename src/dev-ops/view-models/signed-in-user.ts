import {
  toIdentifier,
  toSessionUser,
  toTrimmed
} from '../../common/view-models/actor.ts'
import { toTitleCase } from './shell.ts'

export interface SignedInUser {
  name: string
  email: string
  initials: string
}

/** "Ada Lovelace" is AL; a lone name or an email stands for one letter. */
export const toInitials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')

/** Who the shell says is signed in: the name, or the email standing in for it; null when the session carries neither. */
export const toSignedInUser = (user: unknown): SignedInUser | null => {
  const session = toSessionUser(user)
  const identifier = toIdentifier(session)
  const name = identifier && toTitleCase(identifier)

  return name
    ? { name, email: toTrimmed(session.email), initials: toInitials(name) }
    : null
}
