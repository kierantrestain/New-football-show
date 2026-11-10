import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FORMATIONS, TEAM_COLOURS } from '../src/match'
import type { Match, Side, Team } from '../src/match'
import { formationPoints, importStill, removeStill, syncPlayers, updateMatch } from '../src/model'
import type { Board, Scene } from '../src/model'

const empty: Scene = {
  id: 's', name: 'Scene 1', view: 'full', showAnnotations: true, marks: [], players: [],
  ball: null, formations: { home: '4-3-3', away: '4-3-3' }, minute: 0, addedTime: 0, substitutions: [],
}

function testTeam(side: Side): Team {
  const squad = Array.from({ length: 12 }, (_, index) => ({
    id: `${side}:${index}`, name: String(index + 1), number: index + 1,
  }))
  return {
    id: side, name: side, colour: TEAM_COLOURS[side], squad,
    xi: squad.slice(0, 11).map(({ id }) => id), bench: [squad[11].id], verification: 'manual',
  }
}

const match: Match = {
  id: 'fixture', source: 'test', kickoff: null, score: null, home: testTeam('home'), away: testTeam('away'), substitutions: [],
}

test('all formations contain eleven distinct, correctly oriented positions', () => {
  for (const formation of FORMATIONS) {
    const home = formationPoints(formation, 'home')
    const away = formationPoints(formation, 'away')
    assert.equal(home.length, 11)
    assert.equal(new Set(home.map(({ x, y }) => `${x},${y}`)).size, 11)
    assert.deepEqual(home[0], { x: 64, y: 340 })
    assert.deepEqual(away, home.map(({ x, y }) => ({ x: 1050 - x, y: 680 - y })))
    assert.ok(home.every(({ x, y }) => x < 525 && y > 0 && y < 680))
  }
})

test('switching one formation leaves the other team in place', () => {
  const scene = syncPlayers(empty, match)
  const changed = syncPlayers({ ...scene, formations: { ...scene.formations, home: '3-4-2-1' } }, match, 'home')
  assert.equal(changed.players.length, 22)
  assert.deepEqual(changed.players.map(({ id }) => id), scene.players.map(({ id }) => id))
  assert.notDeepEqual(changed.players.slice(0, 11), scene.players.slice(0, 11))
  assert.deepEqual(changed.players.slice(11), scene.players.slice(11))
})

test('substitution and rewind preserve the edited slot and detach the outgoing carrier', () => {
  const initial = syncPlayers(empty, match)
  const starter = initial.players[1]
  const point = { x: 227, y: 126 }
  const scene = {
    ...initial, minute: 65,
    players: initial.players.map((player) => player.id === starter.id ? { ...player, point } : player),
    ball: { point: starter.point, playerId: starter.id },
    substitutions: [{ teamId: 'home', off: starter.id, on: match.home.bench[0], minute: 65, verification: 'manual' as const }],
  }
  const later = syncPlayers(scene, match)
  assert.equal(later.players.length, 22)
  assert.equal(later.players[1].id, match.home.bench[0])
  assert.equal(later.players[1].slotId, starter.id)
  assert.deepEqual(later.players[1].point, point)
  assert.deepEqual(later.ball, { point: { x: 250, y: 138 } })
  const earlier = syncPlayers({ ...later, minute: 64 }, match)
  assert.equal(earlier.players[1].id, starter.id)
  assert.deepEqual(earlier.players[1].point, point)
})

test('lineup enrichment applies sourced formations before tactical edits', () => {
  const fixture: Match = {
    ...match, home: { ...match.home, xi: [], verification: 'unavailable' }, away: { ...match.away, xi: [], verification: 'unavailable' },
  }
  const board: Board = { version: 1, id: 'b', name: 'Board', match: fixture, scenes: [empty], activeScene: empty.id, updatedAt: 0 }
  const enriched = updateMatch(board, { ...match, home: { ...match.home, formation: '4-2-3-1' } })
  assert.equal(enriched.scenes[0].players.length, 22)
  assert.equal(enriched.scenes[0].formations.home, '4-2-3-1')
  assert.equal(enriched.scenes[0].formations.away, '4-3-3')
})

test('a still has an independent annotation layer and restores the pitch state', () => {
  const pitch: Scene = {
    ...empty, view: 'defensive', showAnnotations: false,
    marks: [{ id: 'm', kind: 'line', colour: '#fff', style: 'solid', points: [{ x: 10, y: 10 }, { x: 90, y: 90 }] }],
  }
  const photo = importStill(pitch, { src: 'data:image/png;base64,', width: 1920, height: 1080, fit: 'fit' })
  assert.deepEqual(photo.marks, [])
  assert.equal(photo.showAnnotations, true)
  assert.deepEqual(removeStill(photo), pitch)
})
