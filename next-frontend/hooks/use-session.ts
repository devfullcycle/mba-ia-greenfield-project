"use client"

import { useContext } from "react"

import { SessionContext, type SessionState } from "@/components/auth/session-provider"

export function useSession(): SessionState {
  return useContext(SessionContext)
}
