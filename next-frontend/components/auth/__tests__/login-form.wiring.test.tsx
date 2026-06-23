// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { server } from "@/mocks/server"
import { LoginForm } from "../login-form"

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

beforeEach(() => {
  refreshMock.mockClear()
})

function envelope(statusCode: number, message: string) {
  return { statusCode, error: "ERR", message, code: null }
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email address"), "alice@example.com")
  await user.type(screen.getByLabelText(/^Password$/), "secret123")
}

describe("<LoginForm /> wiring", () => {
  it("submits a typed payload, refreshes on 200, and exposes no tokens", async () => {
    const user = userEvent.setup()
    const received: Record<string, unknown>[] = []
    server.use(
      http.post("/api/auth/login", async ({ request }) => {
        received.push((await request.json()) as Record<string, unknown>)
        // FE-facing body: BFF strips access_token / refresh_token (TD-02).
        return HttpResponse.json({}, { status: 200 })
      })
    )

    render(<LoginForm />)
    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1))
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      email: "alice@example.com",
      password: "secret123",
    })
    expect(JSON.stringify(received[0])).not.toMatch(/access_token|refresh_token/)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("maps a 401 to a form-level invalid-credentials alert", async () => {
    const user = userEvent.setup()
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json(envelope(401, "Credenciais inválidas"), {
          status: 401,
        })
      )
    )

    render(<LoginForm />)
    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Credenciais inválidas")
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it("maps a 403 to an email-not-confirmed alert with a resend CTA", async () => {
    const user = userEvent.setup()
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json(envelope(403, "E-mail não confirmado"), {
          status: 403,
        })
      )
    )

    render(<LoginForm />)
    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("E-mail não confirmado")
    expect(
      screen.getByRole("link", { name: /Reenviar e-mail de confirmação/i })
    ).toBeInTheDocument()
  })

  it("maps a 400 to an inline error on the email field", async () => {
    const user = userEvent.setup()
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json(envelope(400, "Validation failed"), { status: 400 })
      )
    )

    render(<LoginForm />)
    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByText("Validation failed")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("blocks submit with client-side validation and fires no request until valid", async () => {
    const user = userEvent.setup()
    const onCall = vi.fn()
    server.use(
      http.post("/api/auth/login", () => {
        onCall()
        return HttpResponse.json({}, { status: 200 })
      })
    )

    render(<LoginForm />)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    expect(
      await screen.findByText("Endereço de e-mail inválido")
    ).toBeInTheDocument()
    expect(screen.getByText("Informe sua senha")).toBeInTheDocument()
    expect(onCall).not.toHaveBeenCalled()

    await fillValid(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    await waitFor(() => expect(onCall).toHaveBeenCalledTimes(1))
  })
})
