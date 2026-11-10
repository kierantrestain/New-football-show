import assert from 'node:assert/strict'
import test from 'node:test'
import { loadOpenFootball, normaliseOpenFootball, OPEN_FOOTBALL_URL } from '../src/openFootball'

const clockStart = Date.parse('2026-11-10T12:00:00Z')
const played = {
  round: 'Matchday 1', date: '2026-08-21', time: '20:00', team1: 'Arsenal FC', team2: 'Coventry City FC',
  score: { ft: [3, 0] },
}
const past = {
  round: 'Matchday 6', date: '2026-10-10', time: '12:30', team1: 'Arsenal FC', team2: 'Leeds United FC',
  score: { ht: [1, 0] },
}
const future = {
  round: 'Matchday 13', date: '2026-11-28', time: '15:00', team1: 'Coventry City FC', team2: 'Arsenal FC',
}
const withoutTime = {
  round: 'Matchday 14', date: '2026-12-05', team1: 'Leeds United FC', team2: 'Arsenal FC',
}
const payload = (matches: unknown[]) => ({ name: 'English Premier League 2026/27', matches })

test('separates actual finals, future fixtures, and past fixtures without scores', () => {
  const catalog = normaliseOpenFootball(payload([played, past, future, withoutTime]), clockStart)
  assert.deepEqual(catalog.coverage, { completedThrough: '2026-08-21', missingPast: 1 })
  assert.deepEqual(catalog.fixtures.map(({ status, date, kickoff, score }) => ({ status, date, kickoff, score })), [
    { status: 'finished', date: '2026-08-21', kickoff: '2026-08-21T19:00:00.000Z', score: [3, 0] },
    { status: 'scheduled', date: '2026-11-28', kickoff: '2026-11-28T15:00:00.000Z', score: null },
    { status: 'scheduled', date: '2026-12-05', kickoff: null, score: null },
  ])
  assert.equal(catalog.checkedAt, new Date(clockStart).toISOString())
  assert.equal(catalog.latestUpdatedAt, null)
  assert.equal(catalog.freshnessSec, 300)
  assert.ok(catalog.clubs.every((club) => club.squad.length === 0))
})

test('keeps fixture identity after kickoff changes and ignores invalid final scores', () => {
  const original = normaliseOpenFootball(payload([future]), clockStart).fixtures[0]
  const corrected = normaliseOpenFootball(payload([
    { ...future, date: '2026-11-29', time: '16:30', score: { ft: [2] } },
  ]), clockStart).fixtures[0]
  assert.equal(corrected.id, original.id)
  assert.equal(corrected.status, 'scheduled')
  assert.equal(corrected.score, null)
  assert.notEqual(corrected.kickoff, original.kickoff)
  assert.throws(() => normaliseOpenFootball({ name: 'Other league', matches: [future] }, clockStart), /unexpected/)
})

test('shares a keyless fetch and does not return cached data after a failed refresh', async (t) => {
  let now = clockStart
  t.mock.method(Date, 'now', () => now)
  let next = () => Promise.resolve(Response.json(payload([played])))
  const fetch = t.mock.method(globalThis, 'fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, OPEN_FOOTBALL_URL)
    assert.equal(init?.credentials, 'omit')
    return next()
  })

  const cancelled = new AbortController()
  const aborted = loadOpenFootball(cancelled.signal)
  const accepted = loadOpenFootball(new AbortController().signal)
  cancelled.abort()
  await assert.rejects(aborted, { name: 'AbortError' })
  const first = await accepted
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(await loadOpenFootball(new AbortController().signal), first)

  now += first.freshnessSec * 1000
  next = () => Promise.resolve(new Response(null, { status: 502 }))
  await assert.rejects(loadOpenFootball(new AbortController().signal), /HTTP 502/)
  assert.equal(fetch.mock.callCount(), 2)

  next = () => Promise.resolve(Response.json(payload([played, future])))
  const recovered = await loadOpenFootball(new AbortController().signal)
  assert.equal(fetch.mock.callCount(), 3)
  assert.equal(recovered.checkedAt, new Date(now).toISOString())
  assert.equal(recovered.fixtures.length, 2)
})
