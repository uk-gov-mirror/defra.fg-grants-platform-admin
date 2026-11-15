import type { DefinitionFile } from '../use-cases/definition-fetches.ts'

export type VersionFileType = 'grant' | 'agreement' | 'payment' | 'workflow'

/** What the version page knows of its files, as either page's header carries them. */
export interface VersionFiles {
  code: string
  version: string
  files: Partial<Record<VersionFileType, DefinitionFile>>
  /** Older backends leave it out. */
  s3Bucket?: string | null
}

export type StoredState = 'Stored' | 'Not stored yet' | 'Fetch error' | 'Failed'

export type StatusTone = 'success' | 'neutral' | 'warning' | 'danger'

/** One fixed set of values, so each gets the tone it has on every page. */
export const storedTones: Record<StoredState, StatusTone> = {
  Stored: 'success',
  'Not stored yet': 'neutral',
  'Fetch error': 'warning',
  Failed: 'danger'
}

export const fileOrder: VersionFileType[] = [
  'grant',
  'agreement',
  'payment',
  'workflow'
]

export const fileNames: Record<VersionFileType, string> = {
  grant: 'Grant definition',
  agreement: 'Agreement definition',
  payment: 'Payment definition',
  workflow: 'Workflow definition'
}

/** A file marked Failed is failed even when a copy is stored: the service won't use it. */
export const toStoredState = ({
  stored,
  fetchStatus
}: DefinitionFile): StoredState => {
  if (fetchStatus === 'permanent_error') {
    return 'Failed'
  }

  if (stored) {
    return 'Stored'
  }

  return fetchStatus === 'transient_error' ? 'Fetch error' : 'Not stored yet'
}

export interface StoredDot {
  text: StoredState
  tone: StatusTone
}

export const toStoredDot = (file: DefinitionFile): StoredDot => {
  const text = toStoredState(file)

  return { text, tone: storedTones[text] }
}

/** `bucket/key`, or null when either part is unknown. */
export const toLocation = (
  { s3Bucket }: Pick<VersionFiles, 's3Bucket'>,
  { s3Key }: DefinitionFile
): string | null => (s3Bucket && s3Key ? `${s3Bucket}/${s3Key}` : null)

export interface FileRow {
  type: VersionFileType
  name: string
  location: string | null
  stored: StoredDot
}

/** One row per file the version has, in the order the service lists them. */
export const toFileRows = (version: VersionFiles): FileRow[] =>
  fileOrder.flatMap((type) => {
    const file = version.files[type]

    return file
      ? [
          {
            type,
            name: fileNames[type],
            location: toLocation(version, file),
            stored: toStoredDot(file)
          }
        ]
      : []
  })
