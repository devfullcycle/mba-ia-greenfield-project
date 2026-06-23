import { upstream } from "@/lib/api/upstream";
import { destroySession, getSession } from "@/lib/auth/session";

export async function POST() {
  const session = await getSession();

  // Call upstream to revoke refresh tokens; ignore the result —
  // logout is idempotent locally regardless of upstream response.
  await upstream.POST("/auth/logout", {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  }).catch(() => {
    // Swallow network errors; session destruction below is unconditional.
  });

  await destroySession();

  return new Response(null, { status: 204 });
}
