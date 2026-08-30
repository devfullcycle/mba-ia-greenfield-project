import { expect, test } from "./fixtures"

// 1 spec → 1 file with one describe (feature = target_file stem) + N test() blocks.
// Upstream is faked server-side by mocks/ MSW via instrumentation.ts. The
// /auth/forgot-password handler returns 204 for any email (anti-enumeration)
// and 400 for the reserved trigger badrequest@example.com. No page.route().
test.describe("auth-forgot-password", () => {
  // 1. Solicitar envio de e-mail com link de redefinição de senha

  test("1.1 forgot-password-sucesso-inline", async ({ page }) => {
    await page.goto("/forgot-password")

    const card = page.locator("[data-slot='card']")
    await expect(card).toBeVisible()
    await expect(page.getByLabel("Email address")).toBeVisible()
    const submit = page.getByRole("button", { name: "Send reset link" })
    await expect(submit).toBeVisible()

    await page.getByLabel("Email address").fill("alice@example.com")

    const req = page.waitForRequest(
      (r) =>
        r.url().includes("/api/auth/forgot-password") && r.method() === "POST"
    )
    await submit.click()
    await req

    // Inline confirmation replaces the form within the same Card.
    await expect(page.getByRole("status")).toContainText("Verifique seu e-mail")
    await expect(card).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Send reset link" })
    ).toHaveCount(0)
    await expect(page).toHaveURL(/\/forgot-password$/)
    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name.includes("session"))).toBe(false)
  })

  test("1.2 forgot-password-anti-enumeration", async ({ page }) => {
    await page.goto("/forgot-password")

    await page.getByLabel("Email address").fill("nobody-unregistered@example.com")
    await page.getByRole("button", { name: "Send reset link" }).click()

    const status = page.getByRole("status")
    await expect(status).toContainText("Verifique seu e-mail")
    // Identical confirmation — no reveal of account existence.
    await expect(status).not.toContainText(
      /não existe|not found|no account|conta não/i
    )
  })

  test("1.3 forgot-password-erro-400-e-validacao-client-side", async ({
    page,
  }) => {
    await page.goto("/forgot-password")

    const requests: string[] = []
    page.on("request", (r) => {
      if (r.url().includes("/api/auth/forgot-password"))
        requests.push(r.method())
    })

    await page.getByRole("button", { name: "Send reset link" }).click()
    await expect(
      page.getByText("Endereço de e-mail inválido")
    ).toBeVisible()
    expect(requests).toHaveLength(0)

    await page.getByLabel("Email address").fill("not-an-email")
    await page.getByRole("button", { name: "Send reset link" }).click()
    await expect(
      page.getByText("Endereço de e-mail inválido")
    ).toBeVisible()
    expect(requests).toHaveLength(0)

    // Well-formed email that trips the upstream 400 validation trigger.
    await page.getByLabel("Email address").fill("badrequest@example.com")
    const req = page.waitForRequest(
      (r) =>
        r.url().includes("/api/auth/forgot-password") && r.method() === "POST"
    )
    await page.getByRole("button", { name: "Send reset link" }).click()
    await req

    await expect(page.getByText(/validation failed/i)).toBeVisible()
    await expect(page.getByRole("status")).toHaveCount(0)
  })
})
