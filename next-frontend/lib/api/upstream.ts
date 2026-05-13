import "server-only";
import createClient from "openapi-fetch";
import type { paths } from "./types.gen";
import { env } from "@/lib/env";

export const upstream = createClient<paths>({ baseUrl: env.API_URL });
