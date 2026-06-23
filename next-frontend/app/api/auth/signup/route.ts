import { NextResponse } from "next/server";

import type { RegisterDto, RegisterResponse, ApiErrorEnvelope } from "@/lib/api/contracts";
import { upstream } from "@/lib/api/upstream";

export async function POST(request: Request) {
  const body = (await request.json()) as RegisterDto;

  const { data, error, response } = await upstream.POST("/auth/register", {
    body: body as never,
  });

  if (error) {
    return NextResponse.json<ApiErrorEnvelope>(error as ApiErrorEnvelope, {
      status: response.status,
    });
  }

  return NextResponse.json<RegisterResponse>(data, { status: 201 });
}
