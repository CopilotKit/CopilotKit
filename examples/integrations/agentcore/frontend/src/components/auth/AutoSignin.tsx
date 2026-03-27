"use client"

import { ReactNode, useEffect, useState, PropsWithChildren } from "react"
import { useAuth } from "react-oidc-context"
import { Button } from "@/components/ui/button"

function AutoSigninContent({ children }: PropsWithChildren) {
  const auth = useAuth()

  if (auth.isLoading) {
    return <div className="flex items-center justify-center min-h-screen text-xl">Loading...</div>
  }

  if (!auth.isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-4xl">Please sign in</p>
        <Button onClick={() => auth.signinRedirect()}>Sign In</Button>
      </div>
    )
  }

  return <>{children}</>
}

export function AutoSignin({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return <AutoSigninContent>{children}</AutoSigninContent>
}
