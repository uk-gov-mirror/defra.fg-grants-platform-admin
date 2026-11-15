import type {
  BucketEntry,
  BucketQuery,
  BucketResult
} from '../repositories/buckets.repository.ts'
import { queryBucket } from '../repositories/buckets.repository.ts'
import type { ListResult } from './record-reads.ts'
import { readList } from './record-reads.ts'

export type {
  BucketCell,
  BucketLink,
  BucketPaging,
  BucketPlan,
  BucketResult,
  BucketRow
} from '../repositories/buckets.repository.ts'

/** The URL's filters, the stored search and the place a later page starts from. */
export interface BucketSearch {
  where: Record<string, string | string[]>
  ref?: string
  from?: string
  to?: string
  cursor?: string
}

export type BucketListResult = ListResult<BucketResult | null>

const pageSize = 20

/** Every page asks for the list's total, a search's too: a later page opened without the script draws its own. */
const toQuery = (search: BucketSearch): BucketQuery => ({
  ...search,
  limit: pageSize,
  count: true
})

export const queryBucketUseCase = async (
  bucket: BucketEntry,
  search: BucketSearch,
  repeat: boolean
): Promise<BucketListResult> =>
  readList(
    `bucket ${bucket.id}`,
    () => queryBucket(bucket.id, toQuery(search), repeat),
    null
  )
