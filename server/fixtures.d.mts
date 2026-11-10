import type { FixtureCatalog } from '../src/match'

export function getFixtures(enabled: boolean): Promise<{
  status: number
  body: FixtureCatalog | { message: string }
}>
