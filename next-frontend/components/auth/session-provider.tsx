"use client"

import * as React from "react"

export type SessionState = {
  userId: string
  email: string
  channelSlug: string
  isLoggedIn: boolean
}

const defaultSession: SessionState = {
  userId: "",
  email: "",
  channelSlug: "",
  isLoggedIn: false,
}

const SessionContext = React.createContext<SessionState>(defaultSession)

type SessionProviderProps = {
  initialSession: SessionState
  children: React.ReactNode
}

function SessionProvider({ initialSession, children }: SessionProviderProps) {
  return (
    <SessionContext.Provider value={initialSession}>
      {children}
    </SessionContext.Provider>
  )
}

export { SessionProvider, SessionContext }
