import assert from 'node:assert/strict'
import test from 'node:test'
import { createFixtureAdapter } from '../server/fixtures.mjs'

const now = Date.parse('2026-11-10T10:00:00Z')
const config = {
  MATCH_DATA_PROVIDER: 'football-data.org',
  MATCH_DATA_USE_AUTHORISED: 'true',
  FOOTBALL_DATA_API_TOKEN: 'test-token',
}
const home = { id: 57, name: 'Arsenal FC' }
const away = { id: 61, name: 'Chelsea FC' }
const feed = {
  competition: { code: 'PL' },
  matches: [
    {
      id: 102,
      utcDate: '2026-11-21T17:30:00Z',
      status: 'TIMED',
      matchday: 12,
      lastUpdated: '2026-11-09T22:45:00Z',
      homeTeam: home,
      awayTeam: away,
      score: { fullTime: { home: null, away: null } },
    },
    {
      id: 101,
      utcDate: '2026-11-08T16:30:00Z',
      status: 'FINISHED',
      matchday: 11,
      lastUpdated: '2026-11-10T08:30:00Z',
      homeTeam: away,
      awayTeam: home,
      score: { fullTime: { home: 0, away: 2 } },
    },
  ],
}

test('fixture adapter never contacts the provider without an explicit authorised configuration', async () => {
  let requests = 0
  const getFixtures = createFixtureAdapter({
    fetcher: async () => {
      requests++
      throw new Error('Unexpected upstream request')
    },
    now: () => now,
  })
  for (const env of [
    {},
    { MATCH_DATA_PROVIDER: 'fpl' },
    { ...config, MATCH_DATA_PROVIDER: undefined },
    { ...config, MATCH_DATA_USE_AUTHORISED: undefined },
    { ...config, MATCH_DATA_USE_AUTHORISED: 'false' },
    { ...config, FOOTBALL_DATA_API_TOKEN: undefined },
    { ...config, FOOTBALL_DATA_API_TOKEN: ' ' },
  ]) {
    const result = await getFixtures(env)
    assert.equal(result.status, 503)
    assert.ok('message' in result.body)
    assert.ok(!('fixtures' in result.body))
  }
  assert.equal(requests, 0)
})

test('authorised provider maps dated upcoming fixtures and completed results with source and freshness', async () => {
  const requests: { url: string; token: string | null }[] = []
  const getFixtures = createFixtureAdapter({
    fetcher: async (input, init) => {
      requests.push({ url: String(input), token: new Headers(init?.headers).get('X-Auth-Token') })
      return Response.json(feed)
    },
    now: () => now,
  })
  const { status, body } = await getFixtures(config)
  assert.equal(status, 200)
  assert.deepEqual(requests, [{
    url: 'https://api.football-data.org/v4/competitions/PL/matches',
    token: config.FOOTBALL_DATA_API_TOKEN,
  }])
  assert.ok('fixtures' in body)
  assert.equal(body.source, 'Football data provided by the Football-Data.org API')
  assert.equal(body.checkedAt, '2026-11-10T10:00:00.000Z')
  assert.equal(Date.parse(body.latestUpdatedAt ?? ''), Date.parse(feed.matches[1].lastUpdated))
  assert.equal(body.freshnessSec, 300)
  const fixtures = body.fixtures.map(({ id, homeId, awayId, kickoff, status, week, score }) => ({
    id, homeId, awayId, kickoff: new Date(kickoff ?? '').toISOString(), status, week, score,
  })).sort((left, right) => right.id.localeCompare(left.id))
  assert.deepEqual(fixtures, [
    {
      id: 'football-data.org:match:102',
      homeId: 'football-data.org:club:57',
      awayId: 'football-data.org:club:61',
      kickoff: '2026-11-21T17:30:00.000Z',
      status: 'scheduled',
      week: 12,
      score: null,
    },
    {
      id: 'football-data.org:match:101',
      homeId: 'football-data.org:club:61',
      awayId: 'football-data.org:club:57',
      kickoff: '2026-11-08T16:30:00.000Z',
      status: 'finished',
      week: 11,
      score: [0, 2],
    },
  ])
  assert.deepEqual(body.clubs.map(club => [club.id, club.name, club.squad]).sort(), [
    ['football-data.org:club:57', home.name, []],
    ['football-data.org:club:61', away.name, []],
  ])
  assert.ok(!JSON.stringify(body).includes(config.FOOTBALL_DATA_API_TOKEN))
})

test('an expired fixture catalogue is withheld on upstream failure and the next successful check recovers', async () => {
  let clock = now
  let requests = 0
  let failing = false
  const getFixtures = createFixtureAdapter({
    fetcher: async () => {
      requests++
      if (failing) throw new Error(`Rejected credential: ${config.FOOTBALL_DATA_API_TOKEN}`)
      return Response.json(feed)
    },
    now: () => clock,
  })
  const initial = await getFixtures(config)
  assert.equal(initial.status, 200)
  assert.ok('fixtures' in initial.body)

  clock += 60_000
  assert.deepEqual(await getFixtures(config), initial)
  assert.equal(requests, 1)
  assert.equal((await getFixtures({})).status, 503)

  clock += initial.body.freshnessSec * 1000
  failing = true
  const failed = await getFixtures(config)
  assert.equal(requests, 2)
  assert.equal(failed.status, 502)
  assert.ok('message' in failed.body)
  assert.ok(!('fixtures' in failed.body))
  assert.ok(!JSON.stringify(failed.body).includes(config.FOOTBALL_DATA_API_TOKEN))

  failing = false
  const recovered = await getFixtures(config)
  assert.equal(requests, 3)
  assert.equal(recovered.status, 200)
  assert.ok('fixtures' in recovered.body)
  assert.equal(recovered.body.checkedAt, new Date(clock).toISOString())
})
