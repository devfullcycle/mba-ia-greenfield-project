// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { describe, expect, it, vi } from "vitest"

import { server } from "@/mocks/server"
import { ForgotPasswordForm } from "../forgot-password-form"

function envelope(statusCode: number, message: string) {
  return { statusCode, error: "ERR", message, code: null }
}

describe("<ForgotPasswordForm /> wiring", () => {
  it("submits a typed payload and replaces the form with an inline confirmation on 204", async () => {
    const user = userEvent.setup()
    const received: Record<string, unknown>[] = []
    server.use(
      http.post("/api/auth/forgot-password", async ({ request }) => {
        received.push((await request.json()) as Record<string, unknown>)
        return new HttpResponse(null, { status: 204 })
      })
    )

    render(<ForgotPasswordForm />)
    await user.type(
      screen.getByLabelText("Email address"),
      "alice@example.com"
    )
    await user.click(screen.getByRole("button", { name: "Send reset link" }))

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Verifique seu e-mail"
      )
    )
    expect(received).toEqual([{ email: "alice@example.com" }])
    // Form was replaced by the confirmation box.
    expect(
      screen.queryByRole("button", { name: "Send reset link" })
    ).not.toBeInTheDocument()
  })

  it("renders the identical confirmation for an unregistered email (anti-enumeration)", async () => {
    const user = userEvent.setup()
    server.use(
      http.post("/api/auth/forgot-password", () =>
        // Upstream is a no-op 204 whether or not the account exists.
        new HttpResponse(null, { status: 204 })
      )
    )

    render(<ForgotPasswordForm />)
    await user.type(
      screen.getByLabelText("Email address"),
      "nobody@example.com"
    )
    await user.click(screen.getByRole("button", { name: "Send reset link" }))

    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent("Verifique seu e-mail")
    // No text reveals whether the account exists.
    expect(status.textContent ?? "").not.toMatch(
      /não (existe|encontrad)|not found|no account|conta não/i
    )
  })

  it("maps a 400 to an inline error on the email field without replacing the form", async () => {
    const user = userEvent.setup()
    server.use(
      http.post("/api/auth/forgot-password", () =>
        HttpResponse.json(envelope(400, "Validation failed"), { status: 400 })
      )
    )

    render(<ForgotPasswordForm />)
    await user.type(
      screen.getByLabelText("Email address"),
      "alice@example.com"
    )
    await user.click(screen.getByRole("button", { name: "Send reset link" }))

    expect(await screen.findByText("Validation failed")).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Send reset link" })
    ).toBeInTheDocument()
  })

  it("blocks submit with client-side validation and fires no request until valid", async () => {
    const user = userEvent.setup()
    const onCall = vi.fn()
    server.use(
      http.post("/api/auth/forgot-password", () => {
        onCall()
        return new HttpResponse(null, { status: 204 })
      })
    )

    render(<ForgotPasswordForm />)
    await user.click(screen.getByRole("button", { name: "Send reset link" }))

    expect(
      await screen.findByText("Endereço de e-mail inválido")
    ).toBeInTheDocument()
    expect(onCall).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText("Email address"), "not-an-email")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    expect(onCall).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText("Email address"))
    await user.type(
      screen.getByLabelText("Email address"),
      "alice@example.com"
    )
    await user.click(screen.getByRole("button", { name: "Send reset link" }))

    await waitFor(() => expect(onCall).toHaveBeenCalledTimes(1))
  })
})
