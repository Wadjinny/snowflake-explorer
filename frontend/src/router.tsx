import { createBrowserRouter } from 'react-router'
import RootLayout from './routes/root'
import Explorer from './routes/explorer'
import WorkspaceShell from './routes/workspace'
import ErrorPage from './routes/error-page'

// The transform workspace pulls in ECharts (~380 kB gzip). Browse never draws a
// chart, so keep it out of the first-paint chunk.
const transformRoute = async () => ({
  Component: (await import('./routes/transform')).default,
})

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <ErrorPage />,
    children: [
      {
        element: <WorkspaceShell />,
        children: [
          { index: true, element: <Explorer /> },
          {
            path: 'o/:database/:schema/:name',
            element: <Explorer />,
          },
          {
            path: 's/:selectionId',
            element: <Explorer />,
          },
          {
            path: 't',
            lazy: transformRoute,
          },
          {
            path: 't/:transformId',
            lazy: transformRoute,
          },
        ],
      },
    ],
  },
])
