// Typed client for every backend endpoint. All calls go to /api (proxied to the backend by Vite).

import type {
  Categories, Config, Decision, Health, InputCard, Job, PolicyWeights, RunListItem, RunView,
} from "./types";

export class ApiError extends Error {
  status: number;
  messages: string[];

  constructor(status: number, messages: string[]) {
    super(messages.join(" ") || `Request failed (${status})`);
    this.status = status;
    this.messages = messages;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, ["Cannot reach the backend. Is it running on port 8000?"]);
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    const messages = Array.isArray(detail) ? detail.map(String) : detail ? [String(detail)] : [`${res.status} ${res.statusText}`];
    throw new ApiError(res.status, messages);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: [text.slice(0, 300)] };
  }
}

export const api = {
  health: () => request<Health>("GET", "/health"),
  categories: () => request<Categories>("GET", "/categories"),

  getConfig: () => request<Config>("GET", "/config"),
  putConfig: (config: Config) =>
    request<{ config: Config; inputs_added: number; inputs_removed: number }>("PUT", "/config", config),
  putPolicyWeights: (weights: PolicyWeights) => request<PolicyWeights>("PUT", "/policy-weights", weights),
  rename: (kind: "region" | "segment", old: string, newName: string) =>
    request<{ config: Config }>("POST", "/config/rename", { kind, old, new: newName }),

  getInputs: () => request<InputCard[]>("GET", "/inputs"),
  putInputs: (cards: InputCard[]) => request<InputCard[]>("PUT", "/inputs", cards),
  resetDemo: () => request<{ config: Config; inputs: number }>("POST", "/demo/reset"),

  startAnalysis: (body: { today?: string; focus?: string; notes?: string; use_cache?: boolean }) =>
    request<{ job_id: string; state: string; already_running: boolean }>("POST", "/analyze", body),
  getJob: (jobId: string) => request<Job>("GET", `/analyze/${encodeURIComponent(jobId)}`),
  cancelJob: (jobId: string) => request<{ job_id: string; state: string }>("POST", `/analyze/${encodeURIComponent(jobId)}/cancel`),

  listResults: () => request<RunListItem[]>("GET", "/results"),
  latestResult: () => request<RunView>("GET", "/results/latest"),
  demoResult: () => request<RunView>("GET", "/results/demo"),
  resultById: (runId: string) => request<RunView>("GET", `/results/${encodeURIComponent(runId)}`),

  getDecisions: () => request<Decision[]>("GET", "/decisions"),
  addDecision: (decision: Decision) => request<Decision[]>("POST", "/decisions", decision),
};
