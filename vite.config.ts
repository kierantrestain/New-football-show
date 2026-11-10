import { defineConfig, loadEnv } from 'vite'
import type { Connect } from 'vite'
import { getFixtures } from './server/fixtures.mjs'
import { handleEspnRequest } from './server/espn.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const route: Connect.NextHandleFunction = async (req, res, next) => {
    const path = req.url?.split('?')[0]
    if (path === '/api/espn') {
      const response = await handleEspnRequest(req.method, new URL(req.url!, 'http://localhost'))
      res.statusCode = response.status
      response.headers.forEach((value, key) => res.setHeader(key, value))
      res.end(await response.text())
      return
    }
    if (path !== '/api/fixtures') return next()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET')
      res.end(JSON.stringify({ message: 'Method not allowed.' }))
      return
    }
    try {
      const { status, body } = await getFixtures(env)
      res.statusCode = status
      res.end(JSON.stringify(body))
    } catch {
      res.statusCode = 503
      res.end(JSON.stringify({ message: 'Fixture feed unavailable. Import match data to continue.' }))
    }
  }
  return {
    plugins: [{
      name: 'touchline-fixture-route',
      configureServer: (server) => { server.middlewares.use(route) },
      configurePreviewServer: (server) => { server.middlewares.use(route) },
    }],
  }
})
