export const purgeReasons = [
  { value: 'BROKEN_PAYLOAD', label: 'Payload is broken' },
  { value: 'SENT_IN_ERROR', label: 'Sent in error' },
  { value: 'OTHER', label: 'Other' }
] as const

export type PurgeReasonCode = (typeof purgeReasons)[number]['value']

const labels = new Map<string, string>(
  purgeReasons.map(({ value, label }) => [value, label])
)

/** A code this release does not know is shown as it arrived: a blank where a reason should be would read as no reason at all. */
export const toPurgeReasonLabel = (code: string): string =>
  labels.get(code) ?? code

export const noteMaxLength = 500

const otherReason: PurgeReasonCode = 'OTHER'

export interface PurgeSubmission {
  reasonCode: string
  /** Already normalised and trimmed: a note of spaces is no note. */
  note: string
}

/** A browser sends a textarea's line breaks as CRLF but counts each as one character, so they are folded before the note is trimmed, measured or sent. */
export const toPurgeNote = (note: string): string =>
  note.replace(/\r\n/g, '\n').trim()

export type PurgeField = 'reason' | 'note'

export interface PurgeFormError {
  field: PurgeField
  message: string
}

const missingReason = 'Choose a reason'

const missingNote = 'Say why: the reason is Other'

const longNote = `Shorten the note to ${noteMaxLength} characters or fewer`

/** The first rule that applies is the one reported: one error, one link. */
const rules: [PurgeField, string, (submission: PurgeSubmission) => boolean][] =
  [
    ['reason', missingReason, ({ reasonCode }) => !labels.has(reasonCode)],
    [
      'note',
      missingNote,
      ({ reasonCode, note }) => reasonCode === otherReason && note === ''
    ],
    ['note', longNote, ({ note }) => note.length > noteMaxLength]
  ]

export const toPurgeFormError = (
  submission: PurgeSubmission
): PurgeFormError | null => {
  const broken = rules.find(([, , applies]) => applies(submission))

  return broken === undefined ? null : { field: broken[0], message: broken[1] }
}
