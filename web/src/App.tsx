import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ServicesProvider } from '@/features/viewport/services/service-context'
import { router } from '@/router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ServicesProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </ServicesProvider>
    </QueryClientProvider>
  )
}
