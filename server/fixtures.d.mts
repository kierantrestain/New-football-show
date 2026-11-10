import type { FixtureCatalog } from '../src/match'

type Catalogue = FixtureCatalog & {
  checkedAt: string
  latestUpdatedAt: string | null
  freshnessSec: number
}
type FixtureResponse =
  | { status: 200; body: Catalogue }
  | { status: 502 | 503; body: { message: string; code?: 'NO_PROVIDER' } }
type FixtureLoader = (env: Record<string, string | undefined>) => Promise<FixtureResponse>

export function createFixtureAdapter(options?: { fetcher?: typeof fetch; now?: () => number }): FixtureLoader
export const getFixtures: FixtureLoader
