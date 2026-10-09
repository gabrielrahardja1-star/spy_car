import { config } from '../config'
import type { DataSource } from './source'
import { createMockDataSource } from './mock'
import { createTraccarDataSource } from './traccar'

/**
 * Builds the DataSource named by `config.dataSource`. A misconfiguration fails loudly instead of showing fake data.
 * `onUnauthorized` is only used by the Traccar source: it is called when the server says the session is gone.
 */
export function createDataSource(opts: { onUnauthorized?: () => void } = {}): DataSource {
  switch (config.dataSource) {
    case 'mock':
      return createMockDataSource()
    case 'traccar':
      return createTraccarDataSource({ onUnauthorized: opts.onUnauthorized })
  }
}
