import { expect, test } from "./fixtures"

// 1 spec → 1 file with one describe (feature = target_file stem) + N test() blocks.
// Upstream is faked server-side by mocks/ MSW via instrumentation.ts; per-scenario
// outcomes use reserved trigger emails (invalid@ → 401, unconfirmed@ → 403,
// badrequest@ → 400). No page.route() of /api/** — that would short-circuit the
// real Route Handlers (which seal the iron-session cookie).
test.describe("auth-login", () => {
  // 1. Autenticar usuário com e-mail e senha e iniciar sessão

  test("1.1 login-sucesso-sessao-iniciada", async ({ page }) => {
    await page.goto("/login")

    const card = page.locator("[data-slot='card']")
    await expect(card).toBeVisible()
    await expect(page.getByLabel("Email address")).toBeVisible()
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible()
    const submit = page.getByRole("button", { name: "Sign in" })
    await expect(submit).toBeVisible()

    await page.getByLabel("Email address").fill("user@example.com")
    await page.getByLabel("Password", { exact: true }).fill("secret123")

    const loginRequest = page.waitForRequest(
      (r) => r.url().includes("/api/auth/login") && r.method() === "POST"
    )
    const loginResponse = page.waitForResponse(
      (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST"
    )
    await submit.click()
    await loginRequest
    const res = await loginResponse

    // FE-facing body must NOT carry the tokens (BFF strips them, TD-02).
    const bodyText = await res.text()
    expect(bodyText).not.toMatch(/access_token|refresh_token/)

    // BFF sealed the encrypted iron-session cookie (httpOnly — value opaque).
    await expect
      .poll(async () =>
        (await page.context().cookies()).some((c) =>
          c.name.includes("session")
        )
      )
      .toBe(true)

    // No invalid-credentials / not-confirmed alert on success.
    await expect(page.locator("[data-slot='form-error']")).toHaveCount(0)
  })

  test("1.2 login-erros-401-403-400", async ({ page }) => {
    await page.goto("/login")

    // 401 — invalid credentials → form-level alert.
    await page.getByLabel("Email address").fill("invalid@example.com")
    await page.getByLabel("Password", { exact: true }).fill("whatever1")
    await page.getByRole("button", { name: "Sign in" }).click()

    const alert = page.locator("[data-slot='form-error']")
    await expect(alert).toContainText(/invalid email or password/i)
    expect(
      (await page.context().cookies()).some((c) => c.name.includes("session"))
    ).toBe(false)

    // 403 — email not confirmed → distinct alert + resend CTA.
    await page.getByLabel("Email address").fill("unconfirmed@example.com")
    await page.getByRole("button", { name: "Sign in" }).click()

    const confirmAlert = page.locator("[data-slot='form-confirmation-error']")
    await expect(confirmAlert).toContainText(/email not confirmed/i)
    await expect(
      page.getByRole("link", { name: /Reenviar e-mail de confirmação/i })
    ).toBeVisible()

    // 400 — validation failed → inline below the offending (email) field.
    await page.getByLabel("Email address").fill("badrequest@example.com")
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page.getByText(/validation failed/i)).toBeVisible()
    await expect(page.locator("[data-slot='form-error']")).toHaveCount(0)
  })

  test("1.3 login-validacao-client-side-bloqueia-submit", async ({ page }) => {
    await page.goto("/login")

    const requests: string[] = []
    page.on("request", (r) => {
      if (r.url().includes("/api/auth/login")) requests.push(r.method())
    })

    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByText("Endereço de e-mail inválido")).toBeVisible()
    await expect(page.getByText("Informe sua senha")).toBeVisible()
    expect(requests).toHaveLength(0)

    // Malformed email mirrors the backend rule → submit stays blocked.
    await page.getByLabel("Email address").fill("not-an-email")
    await page.getByLabel("Password", { exact: true }).fill("secret123")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByText("Endereço de e-mail inválido")).toBeVisible()
    expect(requests).toHaveLength(0)

    // Correct to valid values → submit is released.
    await page.getByLabel("Email address").fill("user@example.com")

    const loginRequest = page.waitForRequest(
      (r) => r.url().includes("/api/auth/login") && r.method() === "POST"
    )
    await page.getByRole("button", { name: "Sign in" }).click()
    await loginRequest
    expect(requests.length).toBeGreaterThan(0)
  })
})
