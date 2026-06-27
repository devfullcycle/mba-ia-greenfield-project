import { NextResponse } from "next/server";

import type { ForgotPasswordDto, ApiErrorEnvelope } from "@/lib/api/contracts";
import { upstream } from "@/lib/api/upstream";

export async function POST(request: Request) {
  const body = (await request.json()) as ForgotPasswordDto;

  const { error, response } = await upstream.POST("/auth/forgot-password", {
    body: body as never,
  });

  if (error) {
    return NextResponse.json<ApiErrorEnvelope>(error as ApiErrorEnvelope, {
      status: response.status,
    });
  }

  // 204 pass-through — identical whether email is registered or not (anti-enumeration).
  return new Response(null, { status: 204 });
}
