import { config } from "../config.js";
import { fixtureCohort, matchingSettlement } from "./fixtures.js";
import type { RhoTransaction } from "./types.js";

const extras: RhoTransaction[] = [];

function rhoMode(): "live" | "fixture" {
  const forced = (process.env.RHO_MODE || "auto").toLowerCase();
  if (forced === "fixture") return "fixture";
  if (forced === "live") return "live";
  return config.rho.token ? "live" : "fixture";
}

export function rhoFeedMode() {
  return rhoMode();
}

export function recordMirroredSettlement(order: {
  id: string;
  agentId: string;
  title: string;
  amountCents: number;
  createdAt: string;
  reference: string;
}) {
  extras.push(matchingSettlement(order));
}

function mapLive(raw: Record<string, unknown>): RhoTransaction | null {
  const amount = raw.amount as { amount?: number; currency?: string } | undefined;
  if (!raw.id || !amount || typeof amount.amount !== "number") return null;
  return {
    id: String(raw.id),
    money_movement_id: String(raw.money_movement_id || raw.id),
    account_id: String(raw.account_id || ""),
    account_name: String(raw.account_name || "Rho account"),
    status: (raw.status as RhoTransaction["status"]) || "settled",
    transaction_type: String(raw.transaction_type || "unknown"),
    amount: { amount: amount.amount, currency: amount.currency || "USD" },
    initiated_at: String(raw.initiated_at || new Date().toISOString()),
    posted_at: raw.posted_at ? String(raw.posted_at) : null,
    counterparty_name: String(raw.counterparty_name || ""),
    memo: raw.memo ? String(raw.memo) : undefined,
    note: raw.note ? String(raw.note) : undefined,
    source: "live",
  };
}

async function fetchLive(): Promise<RhoTransaction[]> {
  const params = new URLSearchParams({ status: "settled", page_size: "100" });
  if (config.rho.accountId) params.set("account_id", config.rho.accountId);
  const res = await fetch(`${config.rho.base}/transactions?${params}`, {
    headers: {
      Authorization: `Bearer ${config.rho.token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`Rho ${res.status} ${await res.text().catch(() => "")}`.trim());
  }
  const body = (await res.json()) as { transactions?: Record<string, unknown>[] };
  return (body.transactions || []).map(mapLive).filter((row): row is RhoTransaction => Boolean(row));
}

export async function listRhoTransactions(): Promise<{
  mode: "live" | "fixture";
  liveError?: string;
  transactions: RhoTransaction[];
}> {
  const cohort = fixtureCohort().transactions.concat(extras);
  if (rhoMode() === "fixture" || !config.rho.token) {
    return { mode: "fixture", transactions: cohort };
  }
  try {
    const live = await fetchLive();
    return { mode: "live", transactions: live.concat(extras) };
  } catch (err) {
    return {
      mode: "fixture",
      liveError: err instanceof Error ? err.message : "Rho request failed",
      transactions: cohort,
    };
  }
}

export async function rhoHealth() {
  const feed = await listRhoTransactions();
  return {
    ok: true,
    mode: feed.mode,
    tokenPresent: Boolean(config.rho.token),
    base: config.rho.base,
    liveError: feed.liveError || null,
    count: feed.transactions.length,
    scopes: ["accounts:read", "transactions:read"],
  };
}
