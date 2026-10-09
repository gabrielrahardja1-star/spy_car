import type { RouteObject } from 'react-router-dom'
import { Dashboard } from '../screens/Dashboard/Dashboard'
import { LiveMap } from '../screens/LiveMap/LiveMap'
import { RouteHistory } from '../screens/RouteHistory/RouteHistory'
import { AppShell } from './AppShell'

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <LiveMap /> },
      { path: '/history', element: <RouteHistory /> },
      { path: '/dashboard', element: <Dashboard /> },
    ],
  },
]
