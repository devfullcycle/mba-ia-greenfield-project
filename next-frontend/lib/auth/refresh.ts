import { env } from "@/lib/env";

import { destroySession, getSession, setSession } from "./session";

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const session = await getSession();

  const res = await fetch(`${env.API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });

  if (!res.ok) {
    await destroySession();
    return false;
  }

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
  };

  if (!data.access_token || !data.refresh_token) {
    await destroySession();
    return false;
  }

  await setSession({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    userId: session.userId,
    email: session.email,
    channelSlug: session.channelSlug,
  });

  return true;
}

function refreshOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = tryRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function withRefresh(
  fetcher: () => Promise<Response>
): Promise<Response> {
  const response = await fetcher();

  if (response.status !== 401) {
    return response;
  }

  const refreshed = await refreshOnce();

  if (!refreshed) {
    return new Response(
      JSON.stringify({
        statusCode: 401,
        error: "UNAUTHORIZED",
        message: "Session expired",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  return fetcher();
}
