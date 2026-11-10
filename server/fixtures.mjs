const FPL_URL = 'https://fantasy.premierleague.com/api/'
const FOOTBALL_DATA_URL = 'https://api.football-data.org/v4/competitions/PL/matches'
const FRESHNESS_SECONDS = 300
const roles = ['GK', 'DEF', 'MID', 'FWD']
const footballDataStatuses = new Map([
  ['SCHEDULED', 'scheduled'], ['TIMED', 'scheduled'],
  ['IN_PLAY', 'live'], ['PAUSED', 'live'], ['EXTRA_TIME', 'live'], ['PENALTY_SHOOTOUT', 'live'],
  ['FINISHED', 'finished'], ['AWARDED', 'finished'],
])

const idIsValid = (id) => Number.isSafeInteger(id) && id > 0
const week = (number) => idIsValid(number) && number <= 38 ? number : undefined
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function score(home, away) {
  return Number.isSafeInteger(home) && Number.isSafeInteger(away) && home >= 0 && away >= 0 ? [home, away] : null
}

async function retrieve(fetcher, url, signal, headers = {}) {
  const response = await fetcher(url, { signal, redirect: 'error', headers: { Accept: 'application/json', ...headers } })
  if (!response.ok) throw new Error('Fixture source request failed')
  return response.json()
}

async function footballDataCatalogue(fetcher, token, signal) {
  const data = await retrieve(fetcher, FOOTBALL_DATA_URL, signal, { 'X-Auth-Token': token })
  if (data.competition?.code !== 'PL' || !Array.isArray(data.matches)) throw new Error('Invalid Premier League response')

  const clubs = new Map()
  const ids = new Set()
  let latestUpdate = null
  const clubId = (team) => {
    if (!idIsValid(team?.id) || typeof team.name !== 'string' || !team.name.trim()) throw new Error('Invalid club')
    const id = `football-data.org:club:${team.id}`
    clubs.set(id, { id, name: team.name.trim(), squad: [] })
    return id
  }
  const fixtures = data.matches.flatMap((match) => {
    const status = footballDataStatuses.get(match.status)
    // Postponed, suspended and cancelled records do not fit the catalogue's fixture states.
    if (!status) return []
    if (!idIsValid(match.id) || ids.has(match.id) || match.homeTeam?.id === match.awayTeam?.id) {
      throw new Error('Invalid match ID or teams')
    }
    ids.add(match.id)
    const kickoff = timestamp(match.utcDate)
    if (match.utcDate != null && kickoff === null) throw new Error('Invalid kick-off')
    const updated = timestamp(match.lastUpdated)
    if (updated !== null) latestUpdate = Math.max(latestUpdate ?? updated, updated)
    return [{
      id: `football-data.org:match:${match.id}`,
      homeId: clubId(match.homeTeam),
      awayId: clubId(match.awayTeam),
      kickoff: kickoff === null ? null : new Date(kickoff).toISOString(),
      score: status === 'finished' ? score(match.score?.fullTime?.home, match.score?.fullTime?.away) : null,
      status,
      week: week(match.matchday),
    }]
  })
  return {
    source: 'Football data provided by the Football-Data.org API',
    clubs: [...clubs.values()],
    fixtures,
    latestUpdatedAt: latestUpdate === null ? null : new Date(latestUpdate).toISOString(),
  }
}

async function fplCatalogue(fetcher, signal) {
  const [data, fixtures] = await Promise.all([
    retrieve(fetcher, FPL_URL + 'bootstrap-static/', signal),
    retrieve(fetcher, FPL_URL + 'fixtures/', signal),
  ])
  const clubs = data.teams.map((team) => ({
    id: `pl:club:${team.code}`,
    name: team.name,
    squad: data.elements.filter((player) => player.team === team.id && !player.removed).map((player) => ({
      id: `pl:player:${player.code}`,
      name: player.web_name,
      number: idIsValid(player.squad_number) ? player.squad_number : null,
      role: roles[player.element_type - 1],
    })),
  }))
  const ids = new Map(data.teams.map((team) => [team.id, `pl:club:${team.code}`]))
  return {
    source: 'Fantasy Premier League · fixtures and squad reference',
    clubs,
    fixtures: fixtures.filter((fixture) => fixture.code && ids.has(fixture.team_h) && ids.has(fixture.team_a)).map((fixture) => ({
      id: `pl:match:${fixture.code}`,
      homeId: ids.get(fixture.team_h),
      awayId: ids.get(fixture.team_a),
      kickoff: fixture.kickoff_time,
      score: fixture.finished ? score(fixture.team_h_score, fixture.team_a_score) : null,
      status: fixture.finished ? 'finished' : fixture.started ? 'live' : 'scheduled',
      week: week(fixture.event),
    })),
    latestUpdatedAt: null,
  }
}

// Set MATCH_DATA_USE_AUTHORISED only when the provider permits this app's use.
// football-data.org also requires an application-specific server-side FOOTBALL_DATA_API_TOKEN.
// FPL requires separate permission even though its endpoints do not require a token.
export function createFixtureAdapter({ fetcher = globalThis.fetch, now = Date.now } = {}) {
  let active
  return async function getFixtures(env) {
    const provider = env.MATCH_DATA_PROVIDER
    const token = provider === 'football-data.org' ? env.FOOTBALL_DATA_API_TOKEN?.trim() : undefined
    const configured = provider === 'fpl' || (provider === 'football-data.org' && token)
    if (env.MATCH_DATA_USE_AUTHORISED !== 'true' || !configured) {
      return { status: 503, body: { message: 'No authorised Premier League feed is configured. Enter a fixture or import match data.' } }
    }
    if (!active || active.provider !== provider || active.token !== token) active = { provider, token }
    const entry = active
    if (entry.cached && entry.expires > now()) return { status: 200, body: entry.cached }

    entry.pending ??= (async () => {
      try {
        const signal = AbortSignal.timeout(6500)
        const catalogue = provider === 'football-data.org'
          ? await footballDataCatalogue(fetcher, token, signal)
          : await fplCatalogue(fetcher, signal)
        if (!catalogue.fixtures.length) throw new Error('No supported fixtures in response')
        const checked = now()
        const body = { ...catalogue, checkedAt: new Date(checked).toISOString(), freshnessSec: FRESHNESS_SECONDS }
        entry.cached = body
        entry.expires = checked + FRESHNESS_SECONDS * 1000
        return { status: 200, body }
      } catch {
        return { status: 502, body: { message: 'Could not connect to the Premier League data source. Retry, enter a fixture or import match data.' } }
      } finally {
        entry.pending = undefined
      }
    })()
    return entry.pending
  }
}

export const getFixtures = createFixtureAdapter()
