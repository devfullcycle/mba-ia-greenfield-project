export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.MSW_ENABLED === "true"
  ) {
    const { server } = await import("./mocks/server");
    server.listen({ onUnhandledRequest: "bypass" });
  }
}
