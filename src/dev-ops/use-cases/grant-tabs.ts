import type {
  DefinitionFileType,
  GrantRead,
  GrantVersionHeader
} from '../repositories/grants.repository.ts'

interface GrantTab {
  read: GrantRead
  /** The file the tab shows; null for a tab that needs none. */
  file: DefinitionFileType | null
}

export const grantTabs = {
  overview: { read: 'overview', file: null },
  phases: { read: 'phases', file: 'grant' },
  questions: { read: 'definition', file: 'grant' },
  actions: { read: 'definition', file: 'grant' },
  entitlements: { read: 'entitlements', file: 'grant' },
  agreement: { read: 'agreement', file: 'agreement' },
  payment: { read: 'payment', file: 'payment' },
  raw: { read: 'definition', file: 'grant' }
} as const satisfies Record<string, GrantTab>

export type GrantTabId = keyof typeof grantTabs

export const grantTabIds = Object.keys(grantTabs) as GrantTabId[]

/** A tab for a file the version has not got is not offered. */
export const offersTab = (
  { files }: GrantVersionHeader,
  tab: GrantTabId
): boolean => {
  const { file } = grantTabs[tab]

  return file === null || files[file] !== undefined
}
