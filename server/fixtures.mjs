const BASE_URL = 'https://fantasy.premierleague.com/api/'
const CACHE_AGE = 5 * 60 * 1000
const roles = ['GK', 'DEF', 'MID', 'FWD']
let cached
let pending

async function retrieve(path, signal) {
  const response = await fetch(new URL(path, BASE_URL), { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`FPL responded with ${response.status}`)
  return response.json()
}

async function catalogue() {
  const signal = AbortSignal.timeout(6500)
  const [data, fixtures] = await Promise.all([
    retrieve('bootstrap-static/', signal), retrieve('fixtures/', signal),
  ])
  const clubs = data.teams.map((team) => ({
    id: `pl:club:${team.code}`,
    name: team.name,
    squad: data.elements.filter((player) => player.team === team.id && !player.removed).map((player) => ({
      id: `pl:player:${player.code}`,
      name: player.web_name,
      number: Number.isInteger(player.squad_number) && player.squad_number > 0 ? player.squad_number : null,
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
      score: fixture.finished && Number.isInteger(fixture.team_h_score) && Number.isInteger(fixture.team_a_score)
        ? [fixture.team_h_score, fixture.team_a_score]
        : null,
      status: fixture.finished ? 'finished' : fixture.started ? 'live' : 'scheduled',
      week: fixture.event ?? undefined,
    })),
  }
}

export async function getFixtures(enabled) {
  if (!enabled) return { status: 503, body: { message: 'Fixture feed disabled. Enter a fixture or import authorised match data.' } }
  if (cached && cached.expires > Date.now()) return { status: 200, body: cached.body }
  pending ??= catalogue().then((body) => {
    cached = { body, expires: Date.now() + CACHE_AGE }
    return { status: 200, body }
  }).catch(() => ({
    status: 502, body: { message: 'Fixture feed unavailable. Enter a fixture or import authorised match data.' },
  })).finally(() => { pending = undefined })
  return pending
}
