import assert from 'node:assert/strict'
import test from 'node:test'
import { clearMovementTargets, convexHull, pitchMetres, selectedUnit, setMovementTargets, shiftGroup, teamShapes } from '../src/tactics'
import type { Scene } from '../src/model'

const players = [
  { id: 'hg', name: 'Home keeper', role: 'GK' as const, teamId: 'home', colour: '#ff5050', number: 1, slotId: 'hg', point: { x: 80, y: 340 } },
  { id: 'hd', name: 'Defender', role: 'DEF' as const, teamId: 'home', colour: '#ff5050', number: 2, slotId: 'hd', point: { x: 160, y: 100 } },
  { id: 'hd2', name: 'Defender 2', role: 'DEF' as const, teamId: 'home', colour: '#ff5050', number: 3, slotId: 'hd2', point: { x: 160, y: 570 } },
  { id: 'hm', name: 'Midfielder', role: 'MID' as const, teamId: 'home', colour: '#ff5050', number: 6, slotId: 'hm', point: { x: 350, y: 340 } },
  { id: 'hf', name: 'Forward', role: 'FWD' as const, teamId: 'home', colour: '#ff5050', number: 9, slotId: 'hf', point: { x: 470, y: 330 } },
  { id: 'ag', name: 'Away keeper', role: 'GK' as const, teamId: 'away', colour: '#5099ff', number: 1, slotId: 'ag', point: { x: 980, y: 340 } },
  { id: 'ad', name: 'Away defender', role: 'DEF' as const, teamId: 'away', colour: '#5099ff', number: 2, slotId: 'ad', point: { x: 850, y: 90 } },
  { id: 'ad2', name: 'Away defender 2', role: 'DEF' as const, teamId: 'away', colour: '#5099ff', number: 3, slotId: 'ad2', point: { x: 850, y: 590 } },
  { id: 'am', name: 'Away midfielder', role: 'MID' as const, teamId: 'away', colour: '#5099ff', number: 6, slotId: 'am', point: { x: 650, y: 330 } },
]
const scene: Scene = {
  id: 's', name: 'Shape', view: 'full', marks: [], showAnnotations: true,
  shapeTeams: 'both', players, ball: null,
  formations: { home: '4-3-3', away: '4-3-3' },
  minute: 0, addedTime: 0, substitutions: [],
}

test('distance measurement uses real pitch dimensions and shape excludes goalkeeper', () => {
  assert.equal(pitchMetres({ x: 0, y: 0 }, { x: 30, y: 40 }), 5)
  const shape = teamShapes(scene)
  assert.equal(shape.length, 2)
  assert.equal(shape[0].widthMetres, 47)
  assert.equal(shape[0].depthMetres, 31)
  assert.equal(shape[0].outfieldCount, 4)
  assert.equal(shape[1].widthMetres, 50)
  assert.equal(teamShapes({ ...scene, shapeTeams: 'home' }).length, 1)
  assert.equal(teamShapes({ ...scene, shapeTeams: 'off' }).length, 0)
  assert.equal(teamShapes({ ...scene, image: { src: 'data:', width: 500, height: 300, fit: 'fit' } }).length, 0)
})

test('convex hull remains closed without repeating endpoints and ignores duplicates', () => {
  const hull = convexHull([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 40, y: 40 }, { x: 0, y: 0 }])
  assert.deepEqual(hull, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }])
})

test('unit selection and whole-group drag preserve distances and do not move opponents', () => {
  assert.deepEqual(selectedUnit(scene, 'home', 'defence'), ['hd', 'hd2'])
  assert.deepEqual(selectedUnit(scene, 'home', 'all'), ['hg', 'hd', 'hd2', 'hm', 'hf'])
  const moved = shiftGroup(scene.players, ['hd', 'hd2', 'hm'], { x: 80, y: 50 }, { x: 0, y: 0, width: 1050, height: 680 })
  assert.deepEqual(moved.find(p => p.id === 'hd')?.point, { x: 240, y: 150 })
  assert.deepEqual(moved.find(p => p.id === 'hd2')?.point, { x: 240, y: 620 })
  assert.deepEqual(moved.find(p => p.id === 'ag')?.point, { x: 980, y: 340 })
  assert.deepEqual(scene.players[1].point, { x: 160, y: 100 })
})

test('group target is clamped as a block and never creates visible annotations', () => {
  const target = setMovementTargets(scene, ['hd', 'hd2'], { x: 300, y: 200 }, { x: 0, y: 0, width: 1050, height: 680 })
  assert.equal(target.marks.length, 0)
  assert.deepEqual(target.motionTargets?.hd, { x: 460, y: 210 })
  assert.deepEqual(target.motionTargets?.hd2, { x: 460, y: 680 })
  assert.equal(Math.abs((target.motionTargets?.hd2?.y ?? 0) - (target.motionTargets?.hd?.y ?? 0)), 470)
  assert.equal(clearMovementTargets(target, ['hd']).motionTargets?.hd, undefined)
  assert.equal(Object.keys(clearMovementTargets(target).motionTargets ?? {}).length, 0)
})
