import { handlers as authHandlers } from "./auth";
import { handlers as seedHandlers } from "./_seed";

export const handlers = [...authHandlers, ...seedHandlers];
