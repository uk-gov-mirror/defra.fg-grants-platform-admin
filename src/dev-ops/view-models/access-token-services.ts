import type { ClientService } from '../use-cases/access-tokens.use-case.ts'

export const clientServices: ClientService[] = ['gas', 'cw']

/**
 * What the token in use means on each service's page. Each service flags
 * the token it was itself called with: GAS the one Dev Ops calls it with,
 * CW the one GAS calls it with, as GAS lists CW's tokens for Dev Ops.
 */
export interface InUseWords {
  title: string
  text: string
  /** Who is calling with it: the start of why Revoke is off, and of the refusals that name it. */
  calling: string
  /** Why the old token can't be ended at once on a rotation. */
  keepOld: string
}

export interface ServiceWords {
  short: string
  inUse: InUseWords
}

const keepValid =
  'Rotate it instead, keeping the old one valid while the new one is deployed.'

export const serviceWords: Record<ClientService, ServiceWords> = {
  gas: {
    short: 'GAS',
    inUse: {
      title: 'Dev Ops calls GAS with this token.',
      text: `Revoking it would cut Dev Ops off from GAS. ${keepValid}`,
      calling: 'Dev Ops is calling GAS with this token.',
      keepOld:
        'Not for the token in use: Dev Ops would be locked out of GAS until it has the new token.'
    }
  },
  cw: {
    short: 'CW',
    inUse: {
      title: 'GAS calls CW with this token.',
      text: `Revoking it would cut GAS, and Dev Ops through it, off from CW. ${keepValid}`,
      calling: 'GAS is calling CW with this token.',
      keepOld:
        'Not for the token in use: GAS would be locked out of CW until it has the new token.'
    }
  }
}

export const toNavActive = (service: ClientService): string =>
  `clients-${service}`

export const toClientsPath = (service: ClientService): string =>
  `/dev-ops/clients/${service}`
