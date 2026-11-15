import { getFromGas } from '../../common/gas.ts'
import { needsAttention } from '../use-cases/overview-fixtures.ts'
import { getOverview } from './overview.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('getOverview', () => {
  test('is one GAS read for the whole page', async () => {
    vi.mocked(getFromGas).mockResolvedValue(needsAttention)

    expect(await getOverview()).toBe(needsAttention)
    expect(getFromGas).toHaveBeenCalledExactlyOnceWith('/grant-admin/overview')
  })
})
