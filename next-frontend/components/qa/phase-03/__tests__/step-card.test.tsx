// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { executeStep } from "@/lib/qa/phase-03/runner";
import { STEPS } from "@/lib/qa/phase-03/steps";
import type { StepResult } from "@/lib/qa/phase-03/types";

import { StepCard } from "../step-card";

function Harness({ stepId, respond }: { stepId: string; respond: () => Response }) {
  const step = STEPS.find((s) => s.id === stepId)!;
  const [result, setResult] = useState<StepResult>();
  return (
    <StepCard
      step={step}
      result={result}
      onRun={async (s) => {
        const out = await executeStep(s, {}, { fetchImpl: (async () => respond()) as unknown as typeof fetch, getFile: () => undefined });
        setResult(out.result);
      }}
    />
  );
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("StepCard", () => {
  it("shows the expected result and 'not executed' before running", () => {
    render(<Harness stepId="L3" respond={() => json({}, 404)} />);
    expect(screen.getByText("Não executado")).toBeInTheDocument();
    expect(screen.getByText("HTTP 404")).toBeInTheDocument();
    expect(screen.getByText("código de erro VIDEO_NOT_FOUND")).toBeInTheDocument();
  });

  it("run -> passed when the API answers as expected", async () => {
    render(<Harness stepId="L3" respond={() => json({ error: { code: "VIDEO_NOT_FOUND" } }, 404)} />);
    await userEvent.click(screen.getByRole("button", { name: "Executar L3" }));
    expect(await screen.findByText("✔ Passou")).toBeInTheDocument();
    expect(screen.getByText("Ver detalhes")).toBeInTheDocument();
  });

  it("run -> failed with expected vs received when the API diverges", async () => {
    render(<Harness stepId="L3" respond={() => json({ id: "x" }, 200)} />);
    await userEvent.click(screen.getByRole("button", { name: "Executar L3" }));
    await waitFor(() => expect(screen.getByText("✘ Falhou")).toBeInTheDocument());
    expect(screen.getByText(/HTTP 404:/)).toHaveTextContent("esperado 404, recebido 200");
  });
});
