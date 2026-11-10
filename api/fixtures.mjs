import { getFixtures } from '../server/fixtures.mjs'

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return Response.json({ message: 'Use GET to read fixtures.' }, { status: 405, headers: { Allow: 'GET' } })
    }
    const { status, body } = await getFixtures(process.env)
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  },
}
