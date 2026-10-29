import { QueryClient } from '@tanstack/react-query'

import { isApiError } from '@/lib/errors'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 口令失效、设备明确报错时重试也没用；超时 / 断网重试一次
      retry: (count, error) => count < 1 && (isApiError(error, 'timeout') || isApiError(error, 'network')),
      staleTime: 5_000,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: 0 },
  },
})
