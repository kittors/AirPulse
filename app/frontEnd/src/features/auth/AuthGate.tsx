import { ArrowsClockwise, WifiSlash } from '@phosphor-icons/react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'

import { authStatusStore } from '@/api/auth'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errors'
import { useStore } from '@/lib/store'

import { LoginPage } from './LoginPage'
import { signOutManually, verifyStoredSession } from './session'

const AppShell = lazy(() => import('../shell/AppShell'))

/**
 * 入口分流：校验中 → 启动画面；未登录 → 登录页；已登录 → 控制台。
 * 控制台按需加载，登录页首屏只下载登录需要的代码。
 */
export function AuthGate() {
  const status = useStore(authStatusStore)
  if (status === 'checking') return <SessionCheck />
  if (status === 'signed-out') return <LoginPage />
  return (
    <Suspense fallback={<Splash />}>
      <AppShell />
    </Suspense>
  )
}

function SessionCheck() {
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(() => {
    setError(null)
    verifyStoredSession().catch((err) => setError(errorMessage(err)))
  }, [])
  useEffect(() => run(), [run])
  return <Splash error={error} onRetry={run} />
}

export function Splash({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  const t = useT()
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="ap-page flex flex-col items-center text-center">
        <Logo size={52} />
        <p className="mt-4 text-headline text-text">AirPulse</p>
        {error ? (
          <>
            <p className="mt-3 flex items-center gap-1.5 text-footnote font-medium text-danger-text">
              <WifiSlash className="size-4" weight="bold" />
              {t.auth.connectFailed}
            </p>
            <p className="mt-1 max-w-xs text-caption text-text-3">{error}</p>
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" onClick={signOutManually}>
                {t.shell.logout}
              </Button>
              <Button variant="primary" icon={<ArrowsClockwise weight="bold" />} onClick={onRetry}>
                {t.common.retry}
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-1 text-caption text-text-3">{t.auth.searching}</p>
        )}
      </div>
    </div>
  )
}
