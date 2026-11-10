import assert from 'node:assert/strict'
import test from 'node:test'
import { createEspnFixtureLoader } from '../src/espnFixtures'

const calendar = ['2026-11-07', '2026-11-08', '2026-11-21', '2026-11-22']
const leagues = [{ slug: 'eng.1', calendar: calendar.map(date => date + 'T08:00Z') }]
const lastMatch = {
  id: '401879244',
  competitions: [{
    date: '2026-11-08T14:00Z',
    timeValid: true,
    status: { type: { state: 'post', completed: true, name: 'STATUS_FULL_TIME' } },
    competitors: [
      { homeAway: 'away', score: '0', team: { id: '337', displayName: 'Brentford' } },
      { homeAway: 'home', score: '2', team: { id: '331', displayName: 'Brighton & Hove Albion' } },
    ],
  }],
}
const nextMatch = {
  id: '401879233',
  competitions: [{
    date: '2026-11-21T12:30Z',
    timeValid: true,
    status: { type: { state: 'pre', completed: false, name: 'STATUS_SCHEDULED' } },
    competitors: [
      { homeAway: 'home', score: '0', team: { id: '382', displayName: 'Manchester City' } },
      { homeAway: 'away', score: '0', team: { id: '370', displayName: 'Fulham' } },
    ],
  }],
}
const now = Date.parse('2026-11-10T10:00:00Z')
const base = '/api/espn?resource=scoreboard'

test('loads recent ESPN results and the next calendar date, then browses single match dates', async () => {
  const requests: string[] = []
  const load = createEspnFixtureLoader({
    fetcher: async (input) => {
      const url = String(input)
      requests.push(url)
      if (url === base) return Response.json({ leagues, day: { date: calendar[1] }, events: [lastMatch] })
      if (url === base + '&date=20261121') return Response.json({ leagues, events: [nextMatch] })
      return Response.json({ leagues, events: [] })
    },
    now: () => now,
  })
  const signal = new AbortController().signal
  const [catalog, same] = await Promise.all([load(0, signal), load(0, signal)])
  assert.deepEqual(same, catalog)
  assert.deepEqual(requests, [base, base + '&date=20261121'])
  assert.equal(catalog.source, 'ESPN')
  assert.equal(catalog.windowLabel, '8 Nov 2026 & 21 Nov 2026')
  assert.equal(catalog.hasEarlier, true)
  assert.equal(catalog.hasLater, true)
  assert.deepEqual(catalog.fixtures, [
    { id: '401879244', homeId: '331', awayId: '337', date: calendar[1], kickoff: '2026-11-08T14:00:00.000Z', status: 'finished', score: [2, 0] },
    { id: '401879233', homeId: '382', awayId: '370', date: calendar[2], kickoff: '2026-11-21T12:30:00.000Z', status: 'scheduled', score: null },
  ])
  assert.deepEqual(catalog.clubs.find(club => club.id === '331'), { id: '331', name: 'Brighton & Hove Albion', squad: [] })

  const earlier = await load(-1, signal)
  const later = await load(1, signal)
  assert.equal(earlier.windowLabel, '7 Nov 2026')
  assert.equal(earlier.hasEarlier, false)
  assert.equal(later.windowLabel, '22 Nov 2026')
  assert.equal(later.hasLater, false)
  assert.deepEqual(requests.slice(2), [base + '&date=20261107', base + '&date=20261122'])
  await load(0, signal)
  assert.equal(requests.length, 4)
})

test('ESPN cache expires and an upstream error cannot revive a previous scoreboard', async () => {
  let checkedAt = now
  let unavailable = false
  const load = createEspnFixtureLoader({
    fetcher: async (input) => {
      if (unavailable) return new Response(null, { status: 502 })
      return String(input) === base
        ? Response.json({ leagues, day: { date: calendar[1] }, events: [lastMatch] })
        : Response.json({ leagues, events: [nextMatch] })
    },
    now: () => checkedAt,
  })
  const signal = new AbortController().signal
  const catalog = await load(0, signal)
  unavailable = true
  checkedAt += 60_000
  assert.deepEqual(await load(0, signal), catalog)
  checkedAt += catalog.freshnessSec * 1000
  await assert.rejects(load(0, signal), /ESPN fixture feed returned HTTP 502/)
})
