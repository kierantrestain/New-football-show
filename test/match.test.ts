import assert from 'node:assert/strict'
import test from 'node:test'
import { activeLineup, fixtureMatch, mergeMatchEvents } from '../src/match'
import type { Match, Substitution, Team } from '../src/match'

const verified: Substitution = { teamId: 'home', off: 'a', on: 'b', minute: 68, verification: 'verified' }
const sameOutgoing: Substitution = { teamId: 'home', off: 'a', on: 'c', minute: 50, verification: 'manual' }
const sameIncoming: Substitution = { teamId: 'home', off: 'd', on: 'b', minute: 60, verification: 'manual' }
const chain: Substitution = { teamId: 'home', off: 'b', on: 'c', minute: 75, verification: 'manual' }

test('verified match substitutions take priority over earlier conflicting editorial changes', () => {
  const otherTeam: Substitution = { ...sameOutgoing, teamId: 'away' }
  assert.deepEqual(mergeMatchEvents([verified], [sameOutgoing, sameIncoming, chain, otherTeam]), [otherTeam, verified, chain])
})

test('substitution chains preserve the starting XI slot at each match minute', () => {
  const team: Team = {
    id: 'home', name: 'Home', colour: '#ffffff',
    squad: ['a', 'b', 'c'].map((id, index) => ({ id, name: id, number: index + 1 })),
    xi: ['a'], bench: ['b', 'c'], verification: 'manual',
  }
  const events = [sameOutgoing, chain, verified]
  for (const [minute, id] of [[67, 'a'], [68, 'b'], [75, 'c']] as const) {
    const [{ slotId, player }] = activeLineup(team, events, minute)
    assert.equal(slotId, 'a')
    assert.equal(player.id, id)
  }
})

test('changes recorded in the same minute retain source order', () => {
  const incoming: Substitution = { ...verified, verification: 'manual' }
  const outgoing: Substitution = { ...chain, verification: 'verified', minute: 68 }
  assert.deepEqual(mergeMatchEvents([incoming, outgoing], []), [incoming, outgoing])
})

test('refreshing a fixture replaces feed details and preserves sourced matchday records', () => {
  const home: Team = {
    id: 'home', name: 'Home', colour: '#ffffff', squad: [], xi: [], bench: [],
    verification: 'verified', benchVerification: 'verified', source: 'https://example.com/lineup',
  }
  const away: Team = { ...home, id: 'away', name: 'Away' }
  const existing: Match = {
    id: 'fixture', source: 'Operator entry', kickoff: '2026-08-21T18:00:00Z', score: null,
    status: 'scheduled', home, away, substitutions: [verified], officialUrl: 'https://example.com/fixture',
  }
  const latest = fixtureMatch({
    id: existing.id, homeId: home.id, awayId: away.id,
    kickoff: '2026-08-21T19:00:00Z', score: [3, 0], status: 'finished', week: 1,
  }, { source: 'Fixture feed', clubs: [], fixtures: [] }, existing)
  assert.equal(latest.id, existing.id)
  assert.equal(latest.kickoff, '2026-08-21T19:00:00Z')
  assert.deepEqual(latest.score, [3, 0])
  assert.equal(latest.source, 'Fixture feed')
  assert.equal(latest.home, home)
  assert.equal(latest.away, away)
  assert.equal(latest.substitutions, existing.substitutions)
  assert.equal(latest.officialUrl, existing.officialUrl)
})
