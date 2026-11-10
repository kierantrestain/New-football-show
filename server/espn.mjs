const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_CACHED = 32
const numericId = /^[1-9]\d{0,11}$/

function validDate(value) {
  if (!/^\d{8}$/.test(value)) return false
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === iso
}

function target(params) {
  const resource = params.get('resource')
  const key = resource === 'scoreboard' ? 'date' : resource === 'summary' ? 'eventId' : resource === 'roster' ? 'teamId' : null
  if (!key || params.getAll('resource').length !== 1 || params.getAll(key).length > 1 ||
    [...params.keys()].some((name) => name !== 'resource' && name !== key)) return null

  const value = params.get(key)
  if (resource === 'scoreboard') {
    if (value !== null && !validDate(value)) return null
    const url = new URL('scoreboard', BASE)
    if (value !== null) url.searchParams.set('dates', value)
    return { url, ttl: 60, valid: (data) => Array.isArray(data?.events) }
  }
  if (value === null || !numericId.test(value)) return null
  if (resource === 'summary') {
    const url = new URL('summary', BASE)
    url.searchParams.set('event', value)
    return { url, ttl: 180, valid: (data) => String(data?.header?.id) === value }
  }
  return {
    url: new URL(`teams/${value}/roster`, BASE),
    ttl: 180,
    valid: (data) => String(data?.team?.id) === value && Array.isArray(data?.athletes),
  }
}

async function readBody(response) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') ||
    Number(response.headers.get('content-length')) > MAX_BODY_BYTES || !response.body) {
    await response.body?.cancel()
    throw new Error('Invalid ESPN response')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let body = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) return body + decoder.decode()
    bytes += value.byteLength
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new Error('ESPN response exceeds the size limit')
    }
    body += decoder.decode(value, { stream: true })
  }
}

function problem(message, status, headers) {
  return Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

function success(body, ttl) {
  return new Response(body, { headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': `private, max-age=${ttl}`,
    'X-Content-Type-Options': 'nosniff',
  } })
}

export function createEspnHandler({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map()
  return async function handleEspnRequest(method, url) {
    if (method !== 'GET') return problem('Use GET to read ESPN match data.', 405, { Allow: 'GET' })
    const resource = target(url.searchParams)
    if (!resource) return problem('Choose an ESPN scoreboard date, match ID, or team ID.', 400)

    const key = resource.url.href
    const cached = cache.get(key)
    const remaining = cached ? Math.floor((cached.expires - now()) / 1000) : 0
    if (cached && remaining > 0) return success(cached.body, remaining)
    cache.delete(key)
    try {
      const response = await fetcher(resource.url, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(6500),
      })
      if (!response.ok) {
        await response.body?.cancel()
        if (response.status === 404) return problem('ESPN could not find the requested data.', 404)
        if (response.status === 429) return problem('ESPN is rate limiting requests. Try again shortly.', 502)
        return problem(`ESPN returned HTTP ${response.status}. Try again or import match data.`, 502)
      }
      const body = await readBody(response)
      if (!resource.valid(JSON.parse(body))) return problem('ESPN returned unexpected data. Try again or import match data.', 502)
      if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value)
      cache.set(key, { body, expires: now() + resource.ttl * 1000 })
      return success(body, resource.ttl)
    } catch {
      return problem('ESPN data is unavailable. Try again or import match data.', 502)
    }
  }
}

export const handleEspnRequest = createEspnHandler()
