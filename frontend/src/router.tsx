import { createBrowserRouter } from 'react-router'
import RootLayout from './routes/root'
import Explorer from './routes/explorer'
import TransformWorkspace from './routes/transform'
import WorkspaceShell from './routes/workspace'
import ErrorPage from './routes/error-page'

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
            element: <TransformWorkspace />,
          },
          {
            path: 't/:transformId',
            element: <TransformWorkspace />,
          },
        ],
      },
    ],
  },
])
