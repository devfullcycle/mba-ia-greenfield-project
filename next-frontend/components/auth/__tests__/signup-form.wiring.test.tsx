// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { describe, expect, it, vi } from "vitest"

import { server } from "@/mocks/server"
import { SignupForm } from "../signup-form"

function envelope(statusCode: number, message: string) {
  return { statusCode, error: "ERR", message, code: null }
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Full Name"), "Alice Doe")
  await user.type(screen.getByLabelText("Email address"), "alice@example.com")
  await user.type(screen.getByLabelText(/^Password$/), "Password1")
  await user.type(screen.getByLabelText(/Confirm Password/), "Password1")
  await user.click(screen.getByRole("checkbox"))
}

describe("<SignupForm /> wiring", () => {
  it("submits a typed payload and renders the account-created state on 201", async () => {
    const user = userEvent.setup()
    const received: Record<string, unknown>[] = []
    server.use(
      http.post("/api/auth/signup", async ({ request }) => {
        received.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(
          { id: "user-1", email: "alice@example.com" },
          { status: 201 }
        )
      })
    )

    render(<SignupForm />)
    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Create account" }))

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Conta criada!")
    )
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      email: "alice@example.com",
      password: "Password1",
    })
  })

  it("maps a 409 to an inline email hint with a 'fazer login' CTA", async () => {
    const user = userEvent.setup()
    server.use(
      http.post("/api/auth/signup", () =>
        HttpResponse.json(envelope(409, "Email already registered"), {
          status: 409,
        })
      )
    )

    render(<SignupForm />)
    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Create account" }))

    expect(
      await screen.findByText(/Email already registered/i)
    ).toBeInTheDocument()
    const cta = screen.getByRole("link", { name: /fazer login/i })
    expect(cta).toHaveAttribute("href", "/login")
  })

  it("maps a 400 to a form-level message, not the email field", async () => {
    const user = userEvent.setup()
    server.use(
      http.post("/api/auth/signup", () =>
        HttpResponse.json(envelope(400, "Validation failed"), { status: 400 })
      )
    )

    render(<SignupForm />)
    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Create account" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Validation failed")
    expect(
      screen.queryByRole("link", { name: /fazer login/i })
    ).not.toBeInTheDocument()
  })

  it("blocks submit with client-side validation and fires no request until valid", async () => {
    const user = userEvent.setup()
    const onCall = vi.fn()
    server.use(
      http.post("/api/auth/signup", () => {
        onCall()
        return HttpResponse.json({ id: "x", email: "x@y.z" }, { status: 201 })
      })
    )

    render(<SignupForm />)
    await user.click(screen.getByRole("button", { name: "Create account" }))

    expect(
      await screen.findByText("Endereço de e-mail inválido")
    ).toBeInTheDocument()
    expect(screen.getByText("Você precisa aceitar os termos")).toBeInTheDocument()
    expect(onCall).not.toHaveBeenCalled()

    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Create account" }))

    await waitFor(() => expect(onCall).toHaveBeenCalledTimes(1))
  })
})
