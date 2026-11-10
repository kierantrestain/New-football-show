import assert from 'node:assert/strict'
import test from 'node:test'
import { activeLineup, mergeMatchEvents } from '../src/match'
import type { Substitution, Team } from '../src/match'

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
