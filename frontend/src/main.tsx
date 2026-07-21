import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { ConnectionsProvider } from './connections.tsx'
import { FavoritesProvider } from './favoritesContext.tsx'
import { router } from './router.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConnectionsProvider>
      <FavoritesProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </FavoritesProvider>
    </ConnectionsProvider>
  </StrictMode>,
)
