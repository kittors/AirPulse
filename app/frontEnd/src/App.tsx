import { IconContext } from '@phosphor-icons/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'

import { queryClient } from './app/query'
import { ConfirmProvider } from './components/ui/dialog'
import { TooltipProvider } from './components/ui/overlay'
import { Toaster } from './components/ui/toast'
import { AuthGate } from './features/auth/AuthGate'

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* 系统开了「减弱动态效果」时，Motion 自动去掉位移与缩放，只保留透明度 */}
      <MotionConfig reducedMotion="user">
        <IconContext.Provider value={{ weight: 'regular', size: 20 }}>
          <TooltipProvider delayDuration={250} skipDelayDuration={150}>
            <ConfirmProvider>
              <AuthGate />
              <Toaster />
            </ConfirmProvider>
          </TooltipProvider>
        </IconContext.Provider>
      </MotionConfig>
    </QueryClientProvider>
  )
}
