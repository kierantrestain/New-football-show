import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BoardVisual, getBoardBounds, getViewBox, getVisibleBounds } from '../src/BoardVisual'
import type { Scene, View } from '../src/model'

const scene: Scene = {
  id: 'scene',
  name: 'Test scene',
  view: 'full',
  marks: [{
    id: 'arrow', kind: 'run', colour: '#f8dc63', style: 'solid',
    points: [{ x: 320, y: 190 }, { x: 500, y: 320 }],
    control: { x: 430, y: 180 },
  }],
  showAnnotations: true,
  players: [],
  ball: null,
  formations: { home: '4-3-3', away: '4-3-3' },
  minute: 0,
  addedTime: 0,
  substitutions: [],
}

test('pitch cameras retain the same coordinates and landscape composition', () => {
  const views: View[] = ['full', 'attacking', 'defensive', 'penalty', 'own-penalty']
  for (const view of views) {
    const active = { ...scene, view }
    const frame = getViewBox(active)
    assert.ok(Math.abs(frame.width / frame.height - 16 / 9) < 0.00001)
    assert.deepEqual(getBoardBounds(active), { x: 0, y: 0, width: 1050, height: 680 })
  }
  assert.deepEqual(getVisibleBounds({ ...scene, view: 'attacking' }), { x: 525, y: 0, width: 525, height: 680 })
  assert.deepEqual(getVisibleBounds({ ...scene, view: 'defensive' }), { x: 0, y: 0, width: 525, height: 680 })
  const area = getVisibleBounds({ ...scene, view: 'penalty' })
  assert.ok(area.x <= 885 && area.y <= 138.4 && area.y + area.height >= 541.6)
})

test('still fit and crop retain image-space marks and exclude editing handles from output', () => {
  const fit: Scene = { ...scene, image: { src: 'data:image/png;base64,', width: 1080, height: 1080, fit: 'fit' } }
  const crop: Scene = { ...fit, image: { ...fit.image!, fit: 'crop' } }
  const position = 'M320 190 Q430 180 500 320'
  const edit = renderToStaticMarkup(createElement(BoardVisual, { scene: fit, selection: { players: [], annotation: 'arrow' } }))
  assert.deepEqual(getBoardBounds(fit), getBoardBounds(crop))
  assert.notDeepEqual(getViewBox(fit), getViewBox(crop))
  assert.match(edit, /data-handle="bend"/)
  assert.ok(edit.includes(position))
  const output = renderToStaticMarkup(createElement(BoardVisual, { scene: crop, clean: true, width: 3840, height: 2160 }))
  assert.match(output, /width="3840" height="2160"/)
  assert.ok(output.includes(position))
  assert.doesNotMatch(output, /data-(annotation|handle)/)
})

test('nameplates default to visible and can be hidden without removing shirt numbers', () => {
  const pitch = {
    ...scene,
    players: [{
      id: 'player', name: 'Saka', number: 7, teamId: 'home', colour: '#dc3851',
      point: { x: 370, y: 230 }, slotId: 'slot',
    }],
  }
  const legacy = renderToStaticMarkup(createElement(BoardVisual, { scene: pitch, clean: true }))
  assert.match(legacy, /<text[^>]*>Saka<\/text>/)
  const hidden = { ...pitch, showPlayerNames: false }
  const clean = renderToStaticMarkup(createElement(BoardVisual, { scene: hidden, clean: true }))
  assert.doesNotMatch(clean, /<(text|title)[^>]*>Saka</)
  assert.match(clean, /<text[^>]*>7<\/text>/)
  const editor = renderToStaticMarkup(createElement(BoardVisual, { scene: hidden }))
  assert.match(editor, /<title>Saka<\/title>/)
  assert.match(editor, /aria-label="7, Saka"/)
})

test('a flat zone remains visible and editable', () => {
  const active: Scene = {
    ...scene,
    marks: [{ ...scene.marks[0], kind: 'zone', points: [{ x: 60, y: 100 }, { x: 180, y: 100 }] }],
  }
  const markup = renderToStaticMarkup(createElement(BoardVisual, { scene: active }))
  assert.match(markup, /<rect x="60" y="97" width="120" height="6"/)
})

test('distance labels use pitch metres, still image pixels, and clean output', () => {
  const mark = { id: 'distance', kind: 'distance' as const, colour: '#f8dc63', style: 'solid' as const, points: [{ x: 100, y: 200 }, { x: 400, y: 200 }] }
  const measured: Scene = { ...scene, marks: [mark] }
  const pitch = renderToStaticMarkup(createElement(BoardVisual, { scene: measured, clean: true }))
  assert.match(pitch, /30\.0 m/)
  const still = renderToStaticMarkup(createElement(BoardVisual, { scene: { ...measured, image: { src: 'data:', width: 2100, height: 1360, fit: 'fit' } }, clean: true }))
  assert.match(still, /600 px/)
})

test('team shapes are opt-in, follow the pitch, and motion targets never appear on air', () => {
  const makePlayer = (id: string, x: number, y: number, role: 'GK' | 'DEF' | 'MID' | 'FWD') => ({
    id, slotId: id, name: id, number: 4, role, teamId: 'home', colour: '#ff5050', point: { x, y },
  })
  const pitch: Scene = {
    ...scene, marks: [], shapeTeams: 'home',
    motionTargets: { a: { x: 380, y: 380 } },
    players: [
      makePlayer('g', 60, 340, 'GK'), makePlayer('a', 180, 100, 'DEF'),
      makePlayer('b', 180, 550, 'DEF'), makePlayer('c', 360, 320, 'MID'),
      makePlayer('d', 470, 330, 'FWD'),
    ],
  }
  const editor = renderToStaticMarkup(createElement(BoardVisual, { scene: pitch, showMotionTargets: true }))
  assert.match(editor, /HOME SHAPE/)
  assert.match(editor, /Width 45\.0m/)
  assert.match(editor, /stroke-dasharray="4 5"/)
  const onAir = renderToStaticMarkup(createElement(BoardVisual, { scene: pitch, clean: true }))
  assert.match(onAir, /HOME SHAPE/)
  assert.doesNotMatch(onAir, /stroke-dasharray="4 5"/)
  const hidden = renderToStaticMarkup(createElement(BoardVisual, { scene: { ...pitch, shapeTeams: 'off' }, clean: true }))
  assert.doesNotMatch(hidden, /HOME SHAPE/)
})
