import { defineConfig, loadEnv } from 'vite'
import type { Connect } from 'vite'
import { getFixtures } from './server/fixtures.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const route: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/api/fixtures') return next()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET')
      res.end(JSON.stringify({ message: 'Method not allowed.' }))
      return
    }
    try {
      const { status, body } = await getFixtures(env.ENABLE_FPL === 'true')
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
