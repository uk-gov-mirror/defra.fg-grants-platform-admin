import type { RecordSectionError } from '../use-cases/record-reads.ts'
import { toSectionError, tooLarge } from './record-events-tab.ts'
import type { Message, TabNotice } from './record-events-tab.ts'

export type RawTab =
  | TabNotice
  | { kind: 'document'; json: string }
  | { kind: 'too-large'; text: string }

export interface RawCopy {
  /** What the stored document is, as its sentences name it. */
  noun: string
  error: Message
  nothing: string
}

const kib = 1024
const mib = kib * kib

const sizeFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })

/** "2.4 MiB", or "512 KiB" below a mebibyte. */
export const toSize = (bytes: number): string =>
  bytes >= mib
    ? `${sizeFormat.format(bytes / mib)} MiB`
    : `${sizeFormat.format(bytes / kib)} KiB`

const isTooLarge = (sectionErrors: RecordSectionError[]) =>
  sectionErrors.some(
    ({ section, message }) => section === 'raw' && message === tooLarge
  )

/** GAS's cap is not in its answer, so the sentence gives the document's size alone. */
const tooLargeText = (noun: string, bytes: number | null | undefined) =>
  typeof bytes === 'number'
    ? `The stored ${noun} is ${toSize(bytes)}, too large for this page.`
    : `The stored ${noun} is too large to show on this page.`

export const toRawTab = (
  {
    raw,
    storedBytes,
    sectionErrors
  }: {
    raw?: object | null
    storedBytes?: number | null
    sectionErrors: RecordSectionError[]
  },
  copy: RawCopy,
  tabHref: string
): RawTab => {
  if (isTooLarge(sectionErrors)) {
    return { kind: 'too-large', text: tooLargeText(copy.noun, storedBytes) }
  }

  if (toSectionError(sectionErrors, 'raw')) {
    return { kind: 'error', error: { ...copy.error, retryHref: tabHref } }
  }

  return raw
    ? { kind: 'document', json: JSON.stringify(raw, null, 2) }
    : { kind: 'nothing', title: copy.nothing }
}
