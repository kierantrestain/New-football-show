import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseBoardFile, serialiseBoard } from '../src/boardFile'
import type { Board, Scene } from '../src/model'

const pitchLayer: Scene['pitchLayer'] = {
  view: 'defensive', showAnnotations: false,
  marks: [{ id: 'defence', kind: 'line', style: 'dash', colour: '#f7f9ec', points: [{ x: 155, y: 25 }, { x: 155, y: 642 }] }],
}
const still: Scene = {
  id: 'still', name: 'Still', view: 'full', showAnnotations: true, showPlayerNames: false,
  image: { src: 'data:image/png;base64,iVBORw0KGgo=', width: 1280, height: 720, fit: 'crop' },
  pitchLayer, formations: { home: '4-3-3', away: '4-4-2' }, players: [], ball: null,
  marks: [{ id: 'run', kind: 'run', style: 'solid', colour: '#f8dc63', points: [{ x: 175, y: 170 }, { x: 810, y: 200 }], control: { x: 480, y: 110 } }],
  minute: 0, addedTime: 0, substitutions: [],
}
const board: Board = {
  version: 1, id: 'original', name: 'Running order', match: null,
  scenes: [still, { ...still, id: 'second', name: 'Run replay' }], activeScene: 'second', updatedAt: 1,
}

test('board transfer deduplicates the still and preserves scene order, framing and editable layers', () => {
  const archive = JSON.parse(serialiseBoard(board))
  assert.equal(archive.images.length, 1)
  assert.equal(archive.board.scenes[0].image.asset, 0)
  assert.equal(archive.board.scenes[1].image.asset, 0)
  assert.deepEqual(
    JSON.parse(JSON.stringify(parseBoardFile(archive, 'imported', 2))),
    { ...board, id: 'imported', updatedAt: 2 },
  )
})

test('board import rejects remote image URLs and broken scene selections', () => {
  const remote = JSON.parse(serialiseBoard(board))
  remote.images[0] = 'https://example.com/still.png'
  assert.throws(() => parseBoardFile(remote, 'imported', 2), /embedded still/)
  const broken = JSON.parse(serialiseBoard(board))
  broken.board.activeScene = 'missing'
  assert.throws(() => parseBoardFile(broken, 'imported', 2), /scene order or selection/)
})
