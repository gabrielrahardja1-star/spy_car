// A local stand-in for a Traccar server, so the whole app can run through its real Traccar code path without Docker:
//
//   npm run fake-traccar                                   (listens on http://localhost:8082)
//   VITE_DATA_SOURCE=traccar VITE_TRACCAR_DEV_URL=http://localhost:8082 npm run dev
//
// Sign in with  demo@example.com / demo  (any other credentials are rejected with 401, like Traccar does).
//
// It serves Traccar-shaped JSON (knots, ISO times, WKT with latitude first, trips split at parking of 5 min or more)
// generated from the app's mock data source, so what you see should match mock mode, apart from the differences that
// real Traccar also has. REST: /api/session, /api/devices, /api/geofences, /api/positions, /api/reports/{route,trips,
// stops,summary}. WebSocket: /api/socket (session cookie required), pushing positions as the mock cars move.
// Built on Node only (the WebSocket framing is hand-written; the mock is loaded through Vite so TypeScript just works).
//
// Environment:
//   FAKE_TRACCAR_PORT        port to listen on (default 8082)
//   FAKE_TRACCAR_SPLIT=0     do not split trips at long stops (default: split at 5 min, like Traccar)
//   FAKE_TRACCAR_OMIT_OPEN=1 leave the unfinished trip out of /reports/trips (a Traccar that is behind)
// Extra dev-only endpoints:  POST /fake/expire-sessions  signs everybody out (try the "session ended" path).
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.FAKE_TRACCAR_PORT ?? 8082)
const split = process.env.FAKE_TRACCAR_SPLIT !== '0'

const vite = await createViteServer({
  root,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
})
const { createMockDataSource } = await vite.ssrLoadModule('/src/data/mock/index.ts')
const { createFakeBackend } = await vite.ssrLoadModule('/src/data/traccar/fake/backend.ts')
const { createFakeRouter } = await vite.ssrLoadModule('/src/data/traccar/fake/router.ts')

const mock = createMockDataSource()
const backend = await createFakeBackend(mock, {
  minParkingMs: split ? 5 * 60_000 : Infinity,
  omitOpenTrip: process.env.FAKE_TRACCAR_OMIT_OPEN === '1',
})
const router = createFakeRouter(backend)

// --- REST ---------------------------------------------------------------------------------------------------------
const http = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString('utf8')
  const url = req.url ?? '/'

  if (url === '/fake/expire-sessions' && req.method === 'POST') {
    router.expireSessions()
    for (const client of clients) client.destroy()
    res.writeHead(204).end()
    return
  }
  if (!url.startsWith('/api/')) {
    res.writeHead(404).end()
    return
  }
  try {
    const out = await router.handle({ method: req.method ?? 'GET', url, cookie: req.headers.cookie, body })
    const headers = {}
    if (out.setCookie) headers['Set-Cookie'] = out.setCookie
    if (out.json !== undefined) headers['Content-Type'] = 'application/json'
    res.writeHead(out.status, headers)
    res.end(out.json === undefined ? undefined : JSON.stringify(out.json))
  } catch (e) {
    console.error(e)
    res.writeHead(500).end()
  }
})

// --- WebSocket (RFC 6455, text frames server -> client only) ---------------------------------------------------------
const clients = new Set()

function frame(opcode, payload) {
  const data = Buffer.from(payload)
  const n = data.length
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : null
  if (!head) throw new Error('message too large for this fake')
  return Buffer.concat([head, data])
}

function send(socket, message) {
  if (!socket.destroyed) socket.write(frame(0x1, JSON.stringify(message)))
}

http.on('upgrade', async (req, socket) => {
  if (!req.url?.startsWith('/api/socket') || !router.hasSession(req.headers.cookie)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    return
  }
  const accept = createHash('sha1')
    .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  clients.add(socket)
  socket.on('close', () => clients.delete(socket))
  socket.on('error', () => socket.destroy())
  // Client frames are masked; only close (8) and ping (9) matter here.
  socket.on('data', (buf) => {
    const opcode = buf[0] & 0x0f
    if (opcode === 0x8) socket.end(frame(0x8, Buffer.alloc(0)))
    else if (opcode === 0x9) socket.write(frame(0xa, Buffer.alloc(0)))
  })
  // Like Traccar: the latest positions right after connecting.
  send(socket, { positions: await backend.latestPositions() })
})

mock.subscribe({
  onPositions: (positions) => {
    const message = { positions: backend.toTraccarPositions(positions) }
    for (const client of clients) send(client, message)
  },
})
setInterval(() => {
  for (const client of clients) send(client, {}) // keep-alive
}, 30_000).unref()

http.listen(port, () => {
  console.log(`Fake Traccar on http://localhost:${port}  (sign in: demo@example.com / demo)`)
  console.log(`Trips split at parking: ${split ? 'yes, like Traccar (5 min)' : 'no'}.`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    vite.close().finally(() => process.exit(0))
  })
}
