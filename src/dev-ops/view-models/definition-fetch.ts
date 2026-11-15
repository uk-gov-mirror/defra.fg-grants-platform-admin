import type { DefinitionFetchResult } from '../use-cases/definition-fetches.ts'

export const definitionFetchNoticeKey = 'definitionFetchOutcome'

export interface DefinitionFetchFlash extends DefinitionFetchResult {
  /** A flash the redirect never delivered must not surface on another version. */
  page: string
}
