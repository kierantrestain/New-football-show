import assert from 'node:assert/strict'
import test from 'node:test'
import { getBallPoint } from '../src/BoardVisual'
import { hasPlayableMovement, projectPlayback } from '../src/playback'
import type { Scene } from '../src/model'

const first = {
  id: 'attacker', slotId: 'attacker', name: 'Attacker', number: 9,
  teamId: 'home', colour: '#f00000', point: { x: 300, y: 300 },
}
const second = {
  id: 'receiver', slotId: 'receiver', name: 'Receiver', number: 11,
  teamId: 'home', colour: '#f00000', point: { x: 630, y: 300 },
}
const sample: Scene = {
  id: 'scene', name: 'Analysis', view: 'full',
  marks: [], showAnnotations: true, players: [first, second],
  ball: { playerId: first.id, point: first.point },
  formations: { home: '4-3-3', away: '4-3-3' }, minute: 0, addedTime: 0, substitutions: [],
}

test('run arrows move the nearest player smoothly without changing saved positions', () => {
  const scene: Scene = { ...sample, marks: [{
    id: 'run', kind: 'run', points: [{ x: 320, y: 300 }, { x: 480, y: 340 }],
    control: { x: 400, y: 260 }, colour: '#ffff00', style: 'solid',
  }] }
  assert.equal(hasPlayableMovement(scene), true)
  const middle = projectPlayback(scene, .5)
  assert.ok(middle.players[0].point.x > 300 && middle.players[0].point.x < 480)
  assert.ok(middle.players[0].point.y < 340)
  assert.deepEqual(middle.players[1].point, second.point)
  assert.deepEqual(getBallPoint(middle.ball, middle.players), {
    x: middle.players[0].point.x + 23, y: middle.players[0].point.y + 12,
  })
  assert.deepEqual(projectPlayback(scene, 1).players[0].point, { x: 480, y: 340 })
  assert.deepEqual(scene.players[0].point, { x: 300, y: 300 })
  assert.deepEqual(scene.ball?.playerId, first.id)
})

test('carry moves the player and attaches the ball to the runner for presentation', () => {
  const scene: Scene = { ...sample, ball: null, marks: [{
    id: 'carry', kind: 'carry', points: [{ x: 320, y: 300 }, { x: 500, y: 370 }],
    colour: '#ffff00', style: 'solid',
  }] }
  const projected = projectPlayback(scene, .75)
  assert.equal(projected.ball?.playerId, first.id)
  assert.ok(projected.players[0].point.x > 300)
  assert.deepEqual(scene.ball, null)
})

test('a passing arrow sends the ball in flight and attaches it to the receiving player', () => {
  const scene: Scene = { ...sample, marks: [{
    id: 'pass', kind: 'pass', points: [{ x: 320, y: 300 }, { x: 610, y: 300 }],
    colour: '#ffffff', style: 'dash',
  }] }
  const flight = projectPlayback(scene, .5)
  assert.equal(flight.ball?.playerId, undefined)
  assert.ok((flight.ball?.point.x ?? 0) > 320 && (flight.ball?.point.x ?? 0) < 610)
  const caught = projectPlayback(scene, 1)
  assert.equal(caught.ball?.playerId, second.id)
  assert.deepEqual(getBallPoint(caught.ball, caught.players), { x: 653, y: 312 })
  assert.equal(scene.ball?.playerId, first.id)
})

test('uninvolved scene and still-image analysis remain untouched', () => {
  assert.equal(hasPlayableMovement(sample), false)
  assert.deepEqual(projectPlayback(sample, .6), sample)
  const photo: Scene = { ...sample, image: { src: 'data:', width: 1920, height: 1080, fit: 'fit' }, marks: [{
    id: 'pass', kind: 'pass', points: [{ x: 200, y: 200 }, { x: 800, y: 400 }],
    colour: '#ffffff', style: 'solid',
  }] }
  assert.equal(hasPlayableMovement(photo), false)
  assert.strictEqual(projectPlayback(photo, .8), photo)
})
