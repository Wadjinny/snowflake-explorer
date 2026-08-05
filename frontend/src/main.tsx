import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { ConnectionsProvider } from './connections.tsx'
import { DialogProvider } from './dialog.tsx'
import { FavoritesProvider } from './favoritesContext.tsx'
import { SelectionsProvider } from './selectionsContext.tsx'
import { BrowseTabsProvider } from './browseTabsContext.tsx'
import { TransformationsProvider } from './transformationsContext.tsx'
import { TransformTabsProvider } from './transformTabsContext.tsx'
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
    <DialogProvider>
      <ConnectionsProvider>
        <FavoritesProvider>
          <SelectionsProvider>
            <TransformationsProvider>
              <TransformTabsProvider>
                <BrowseTabsProvider>
                  <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                  </QueryClientProvider>
                </BrowseTabsProvider>
              </TransformTabsProvider>
            </TransformationsProvider>
          </SelectionsProvider>
        </FavoritesProvider>
      </ConnectionsProvider>
    </DialogProvider>
  </StrictMode>,
)
