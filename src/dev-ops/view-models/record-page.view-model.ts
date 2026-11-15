import type { RecordSectionError } from '../use-cases/record-reads.ts'
import { backKey } from './bucket-links.ts'
import { toFittingBack } from './record-filters.ts'
import type { RecordType } from './record-type.ts'

interface SectionTab {
  id: string
  label: string
  href: string
  active: boolean
}

/** Every tab keeps the list the record was opened from, so Back still returns to it. */
export const toTabHref = (
  href: string,
  tab: string,
  from: string,
  extra?: Record<string, string>
): string => {
  const params = new URLSearchParams({
    ...(tab === 'overview' ? {} : { tab }),
    ...(from === '' ? {} : { [backKey]: toFittingBack(from) }),
    ...extra
  })

  return params.size ? `${href}?${params}` : href
}

export const toTabs = (
  { tabs }: RecordType,
  href: string,
  active: string,
  from: string
): SectionTab[] =>
  tabs.map(({ id, label }) => ({
    id,
    label,
    href: toTabHref(href, id, from),
    active: id === active
  }))

/** GAS's own words for a document it will not show; any other Raw failure is an error like any tab's. */
const tooLargeToShow = 'too large to show'

const isTooLarge = ({ message }: RecordSectionError): boolean =>
  message === tooLargeToShow

/** @param section The GAS read the tab shows, which names its errors. */
export const toTooLarge = (
  sectionErrors: RecordSectionError[],
  section: string
): boolean =>
  sectionErrors.some((error) => error.section === section && isTooLarge(error))

/** Never too large to show: that is a warning of its own, not an error. */
export const toSectionError = (
  sectionErrors: RecordSectionError[],
  section: string
): string | null =>
  sectionErrors.find((error) => error.section === section && !isTooLarge(error))
    ?.message ?? null
