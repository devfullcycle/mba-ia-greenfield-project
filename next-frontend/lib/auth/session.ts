import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

export interface SessionData {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  channelSlug: string;
  isLoggedIn: boolean;
}

export const sessionOptions: SessionOptions = {
  password: env.SESSION_PASSWORD,
  cookieName: "streamtube_session",
  ttl: 60 * 60 * 24 * 14, // 14 days (matches refresh-token horizon)
  cookieOptions: {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function setSession(data: Omit<SessionData, "isLoggedIn">) {
  const session = await getSession();
  session.accessToken = data.accessToken;
  session.refreshToken = data.refreshToken;
  session.userId = data.userId;
  session.email = data.email;
  session.channelSlug = data.channelSlug;
  session.isLoggedIn = true;
  await session.save();
}

export async function destroySession() {
  const session = await getSession();
  session.destroy();
}
