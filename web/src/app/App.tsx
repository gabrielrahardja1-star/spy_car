import { RouterProvider } from 'react-router-dom'
import type { createBrowserRouter } from 'react-router-dom'
import { config } from '../config'
import { DataProvider } from '../data/DataProvider'
import { createDataSource } from '../data/factory'
import { createTraccarAuth } from '../data/traccar'
import { TraccarGate } from './TraccarGate'

const auth = config.dataSource === 'traccar' ? createTraccarAuth({ baseUrl: config.traccarUrl, fetch: (i, init) => fetch(i, init) }) : null
const createSource = (onUnauthorized: () => void) => createDataSource({ onUnauthorized })

/** Mock mode renders the app directly, exactly as before. Traccar mode puts the login gate in front of it. */
export function App({ router }: { router: ReturnType<typeof createBrowserRouter> }) {
  if (auth) {
    return (
      <TraccarGate auth={auth} createSource={createSource}>
        <RouterProvider router={router} />
      </TraccarGate>
    )
  }
  return (
    <DataProvider>
      <RouterProvider router={router} />
    </DataProvider>
  )
}
