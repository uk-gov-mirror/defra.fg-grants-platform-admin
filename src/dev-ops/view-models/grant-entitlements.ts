import { toHumanCode } from './position.ts'
import type {
  EntitlementField,
  EntitlementTemplate,
  GrantEntitlements,
  HelpBlock,
  TemplatePosition
} from '../use-cases/get-grant-page.use-case.ts'
import type { BadgeRole } from '../use-cases/get-event.use-case.ts'
import { contextRootsOf, toMappingValue } from './mapping-table.ts'

/** A position, linked to it on Phases; one that stops at the phase or stage is every status under it. */
export interface Chip {
  /** The status's name in the grant, or the phase and stage of a prefix. */
  label: string
  /** The full position. */
  code: string
  any: 'status' | 'stage-and-status' | null
  href: string
}

interface Move {
  from: Chip
  to: Chip
}

type OnSubmit =
  | { kind: 'cant-claim'; reason: 'materialised' | 'no-claimable-at' }
  | { kind: 'waits-for-approval' }
  | {
      kind: 'requests-payment'
      payment: PaymentFileState
      move: Move | null
    }
  | { kind: 'no-payment-file'; move: Move | null }

type Warning =
  | { kind: 'materialised-claim' | 'no-claimable-at'; claimCode: string }
  | {
      kind: 'claim-payment-reads-agreement'
      claimCode: string
      paymentHref: string
    }

/** GAS fetches a payment file it has not stored when it first needs it, and refuses one it has marked failed. */
export type PaymentFileState = 'stored' | 'not-stored' | 'failed'

type FieldSource = 'Entered' | 'Fixed' | 'From agreement'

interface TemplateCard {
  claimCode: string
  name: string
  description: string | null
  materialised: boolean
  maxEntitlements: number
  availableAt: Chip[]
  claim: {
    claimableAt: Chip[]
    maximumClaims: number
    partial: boolean
    approval: boolean
    evidence: boolean
  } | null
  onSubmit: OnSubmit
  onSubmitRole: BadgeRole
  warnings: Warning[]
  fields: {
    name: string
    source: FieldSource
    text: string
    unit: string
    bounds: string[]
  }[]
  help: { summary: string; content: HelpBlock[] } | null
}

export interface EntitlementsTab {
  /** No template and no claim rules: nothing to show but that. */
  nothing: boolean
  claims: {
    move: Move | null
    paymentHref: string | null
    roles: { allOf: string[]; anyOf: string[] } | null
  }
  templates: TemplateCard[]
}

interface EntitlementsSource {
  entitlements: GrantEntitlements
  /** Null when the version names no payment file. */
  payment: PaymentFileState | null
}

interface EntitlementsHrefs {
  /** The Phases tab, with that status selected. */
  phases: (status: string | null) => string
  payment: string
}

type Claims = GrantEntitlements['claims']

type ToChip = (position: TemplatePosition) => Chip

const claimableAtOf = ({ claim }: EntitlementTemplate): TemplatePosition[] =>
  claim?.claimableAt ?? []

/** GAS rejects every claim against a materialised template, one with no `claim`, or one with no `claimableAt`. */
const isClaimable = (template: EntitlementTemplate) =>
  !template.materialised && claimableAtOf(template).length > 0

/** GAS raises the payment on submit for a claim that needs no approval (`claims.service.js`). */
const paysOnSubmit = (template: EntitlementTemplate) =>
  isClaimable(template) && !template.claim?.requiresApproval

const cantClaim = (template: EntitlementTemplate): OnSubmit => ({
  kind: 'cant-claim',
  reason: template.materialised ? 'materialised' : 'no-claimable-at'
})

/** GAS raises the payment when the version names a payment file, stored or not. */
const toPaymentOutcome = (
  { payment }: EntitlementsSource,
  move: Move | null
): OnSubmit =>
  payment
    ? { kind: 'requests-payment', payment, move }
    : { kind: 'no-payment-file', move }

const onSubmitRoles: Record<OnSubmit['kind'], BadgeRole> = {
  'cant-claim': 'neutral',
  'waits-for-approval': 'info',
  'requests-payment': 'success',
  'no-payment-file': 'warning'
}

const matches = (part: string | undefined, actual: string | undefined) =>
  part === undefined || part === actual

/** A claimable-at entry covers every position under it. */
const covers = (entry: TemplatePosition, position: TemplatePosition) =>
  entry.phase === position.phase &&
  matches(entry.stage, position.stage) &&
  matches(entry.status, position.status)

/** GAS moves only on a claim submitted exactly at the move's current position (`claimApprovalTransitionFor`). */
const toTemplateMove = (
  template: EntitlementTemplate,
  claims: NonNullable<Claims>,
  move: Move | null
): Move | null => {
  const current = claims.onClaimApproval?.currentPosition

  return current &&
    claimableAtOf(template).some((entry) => covers(entry, current))
    ? move
    : null
}

const toOnSubmit = (
  template: EntitlementTemplate,
  source: EntitlementsSource,
  move: Move | null
): OnSubmit => {
  if (!isClaimable(template)) {
    return cantClaim(template)
  }

  if (template.claim?.requiresApproval) {
    return { kind: 'waits-for-approval' }
  }

  return toPaymentOutcome(source, move)
}

/** A stage prefix selects the stage's first status; a phase-only one has no stage to select, so it opens the phase's card. */
const toPrefixChip = (
  { phase, stage }: TemplatePosition,
  hrefs: EntitlementsHrefs
): Chip => {
  const code = stage ? `${phase}:${stage}` : phase

  return {
    label: code,
    code,
    any: stage ? 'status' : 'stage-and-status',
    href: stage ? hrefs.phases(code) : `${hrefs.phases(null)}#phase-${phase}`
  }
}

/** A status by its name in the grant, else its code made readable: never the bare code. */
const toStatusName = (
  names: Record<string, string> | undefined,
  code: string,
  status: string
): string => names?.[code] ?? toHumanCode(status)

const toChip =
  (hrefs: EntitlementsHrefs, names?: Record<string, string>): ToChip =>
  (position) => {
    if (!position.status || !position.stage) {
      return toPrefixChip(position, hrefs)
    }

    const code = [position.phase, position.stage, position.status].join(':')

    return {
      label: toStatusName(names, code, position.status),
      code,
      any: null,
      href: hrefs.phases(code)
    }
  }

const toMove = (
  move: NonNullable<Claims>['onClaimApproval'],
  chip: ToChip
): Move | null =>
  move
    ? { from: chip(move.currentPosition), to: chip(move.targetPosition) }
    : null

const toRoles = (
  roles: NonNullable<Claims>['requiredRoles']
): EntitlementsTab['claims']['roles'] =>
  roles ? { allOf: roles.allOf ?? [], anyOf: roles.anyOf ?? [] } : null

const isPresent = (bound: string | null): bound is string => bound !== null

const toBound = (label: string, value: number | null | undefined) =>
  value === null || value === undefined ? null : `${label} ${value}`

const toBounds = (field: EntitlementField): string[] =>
  (field.unitType === 'decimal'
    ? [
        toBound('min', field.minValue),
        toBound('max', field.maxValue),
        `${field.decimalPlaces} dp`
      ]
    : [
        toBound('min length', field.minLength),
        toBound('max length', field.maxLength)
      ]
  ).filter(isPresent)

const isFromAgreement = ({ value }: EntitlementField): boolean =>
  toMappingValue(value).kind === 'expression'

/** GAS resolves a `jsonata:` value against the agreement when it creates the entitlement. */
const toSource = (field: EntitlementField): FieldSource => {
  if (field.input) {
    return 'Entered'
  }

  return isFromAgreement(field) ? 'From agreement' : 'Fixed'
}

const toFieldText = (field: EntitlementField): string => {
  if (field.input) {
    return field.label ?? ''
  }

  return toMappingValue(field.value).text
}

const toUnit = ({ unitType, unit }: EntitlementField): string =>
  unit ? `${unitType} (${unit})` : unitType

const toFields = (
  fields: EntitlementTemplate['fields'] = {}
): TemplateCard['fields'] =>
  Object.entries(fields).map(([name, field]) => ({
    name,
    source: toSource(field),
    text: toFieldText(field),
    unit: toUnit(field),
    bounds: toBounds(field)
  }))

const toClaimRules = (
  template: EntitlementTemplate,
  chip: ToChip
): TemplateCard['claim'] =>
  template.claim
    ? {
        claimableAt: claimableAtOf(template).map(chip),
        maximumClaims: template.claim.limits.maximumClaims,
        partial: template.claim.limits.allowsPartialClaims,
        approval: template.claim.requiresApproval,
        evidence: template.claim.requiresEvidence
      }
    : null

interface WarningRule {
  applies: (template: EntitlementTemplate, readsAgreement: boolean) => boolean
  warn: (claimCode: string, paymentHref: string) => Warning
}

/** In this order within a template. */
const warningRules: WarningRule[] = [
  {
    applies: ({ materialised, claim }) => materialised && claim !== undefined,
    warn: (claimCode) => ({ kind: 'materialised-claim', claimCode })
  },
  {
    applies: (template) =>
      !template.materialised &&
      template.claim !== undefined &&
      claimableAtOf(template).length === 0,
    warn: (claimCode) => ({ kind: 'no-claimable-at', claimCode })
  },
  {
    applies: (template, readsAgreement) =>
      readsAgreement && paysOnSubmit(template),
    warn: (claimCode, paymentHref) => ({
      kind: 'claim-payment-reads-agreement',
      claimCode,
      paymentHref
    })
  }
]

/** Claim payments carry only `claim` and `execution` (`handle-claim-payment-requested.js`). */
const readsAgreement = (payment: Record<string, unknown> | null): boolean =>
  payment !== null && contextRootsOf(payment).has('agreement')

const hasClaimRules = (claims: NonNullable<Claims>): boolean =>
  claims.onClaimApproval !== undefined || claims.requiredRoles !== undefined

export const toEntitlementsTab = (
  source: EntitlementsSource,
  hrefs: EntitlementsHrefs
): EntitlementsTab => {
  const { entitlementTemplates, payment } = source.entitlements
  const claims = source.entitlements.claims ?? {}
  const chip = toChip(hrefs, source.entitlements.statusNames)
  const move = toMove(claims.onClaimApproval, chip)
  const paymentReadsAgreement = readsAgreement(payment)

  const toCard = (template: EntitlementTemplate): TemplateCard => {
    const onSubmit = toOnSubmit(
      template,
      source,
      toTemplateMove(template, claims, move)
    )

    return {
      claimCode: template.claimCode,
      name: template.name,
      description: template.description ?? null,
      materialised: template.materialised,
      maxEntitlements: template.maxEntitlements,
      availableAt: template.availableAt.map(chip),
      claim: toClaimRules(template, chip),
      onSubmit,
      onSubmitRole: onSubmitRoles[onSubmit.kind],
      warnings: warningRules
        .filter(({ applies }) => applies(template, paymentReadsAgreement))
        .map(({ warn }) => warn(template.claimCode, hrefs.payment)),
      fields: toFields(template.fields),
      help: template.help ?? null
    }
  }

  return {
    nothing: entitlementTemplates.length === 0 && !hasClaimRules(claims),
    claims: {
      move,
      paymentHref: source.payment ? hrefs.payment : null,
      roles: toRoles(claims.requiredRoles)
    },
    templates: entitlementTemplates.map(toCard)
  }
}
