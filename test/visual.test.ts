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
