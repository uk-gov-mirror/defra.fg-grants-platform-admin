import Joi from 'joi'

import type {
  EventCounts,
  EventService
} from '../use-cases/get-events.use-case.ts'

const eventStatuses: (keyof EventCounts)[] = [
  'PUBLISHED',
  'PROCESSING',
  'FAILED',
  'RESUBMITTED',
  'COMPLETED',
  'DEAD_LETTER',
  'PURGED'
]

export const eventServices: { value: EventService; label: string }[] = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'CW-BE' }
]

const auditModes = ['include'] as const

export const eventEnumFilters = {
  status: Joi.string().valid(...eventStatuses),
  service: Joi.string().valid(...eventServices.map(({ value }) => value)),
  audit: Joi.string().valid(...auditModes)
}
