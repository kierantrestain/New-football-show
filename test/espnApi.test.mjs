import assert from 'node:assert/strict'
import test from 'node:test'
import { createEspnHandler } from '../server/espn.mjs'

const url = (query) => new URL(`https://touchline.test/api/espn?${query}`)

test('ESPN route rejects unknown inputs before reaching the provider', async () => {
  const handle = createEspnHandler({ fetcher: () => assert.fail('Unexpected provider request') })
  const method = await handle('POST', url('resource=scoreboard'))
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('Allow'), 'GET')
  for (const query of [
    'resource=scoreboard&date=20260231',
    'resource=scoreboard&date=20261101-20261110',
    'resource=summary&eventId=401879244&eventId=401879233',
    'resource=roster&teamId=331&url=https://example.com',
    'resource=roster&teamId=../scoreboard',
  ]) assert.equal((await handle('GET', url(query))).status, 400, query)
})

test('ESPN route fetches the fixed resource and caches the original JSON briefly', async () => {
  const raw = '{ "events": [] }'
  let now = 0
  let calls = 0
  const handle = createEspnHandler({ now: () => now, fetcher: async (target, options) => {
    calls++
    assert.equal(target.href, 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261121')
    assert.equal(options.redirect, 'error')
    return new Response(raw, { headers: { 'Content-Type': 'application/json;charset=UTF-8' } })
  } })
  const target = url('resource=scoreboard&date=20261121')
  assert.equal(await (await handle('GET', target)).text(), raw)
  now += 30000
  assert.equal((await handle('GET', target)).headers.get('Cache-Control'), 'private, max-age=30')
  assert.equal(calls, 1)
  now += 30000
  assert.equal((await handle('GET', target)).status, 200)
  assert.equal(calls, 2)
})

test('ESPN provider denial is surfaced without an automatic retry', async () => {
  let calls = 0
  const handle = createEspnHandler({ fetcher: async () => {
    calls++
    return new Response('Access denied', { status: 403 })
  } })
  const response = await handle('GET', url('resource=roster&teamId=331'))
  assert.equal(response.status, 502)
  assert.match((await response.json()).message, /HTTP 403/)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(calls, 1)
})
