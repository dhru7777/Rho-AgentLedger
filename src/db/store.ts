import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR } from "../config.js";

export type LedgerRail = "crypto" | "fiat";
export type LedgerDirection = "in" | "out";

export type StoredTx = {
  id: string;
  at: string;
  agentId: string;
  role: "buyer" | "seller";
  rail: LedgerRail;
  direction: LedgerDirection;
  amountCents: number;
  currency: "USD" | "USDC";
  status: string;
  title: string;
  reference: string;
  explorerUrl?: string;
  stripePaymentIntentId?: string;
  circleTxHash?: string;
};

type Store = { transactions: StoredTx[] };

const PATH = join(ROOT_DIR, "data", "ledger.json");

function empty(): Store {
  return { transactions: [] };
}

function read(): Store {
  try {
    if (!existsSync(PATH)) return empty();
    const raw = JSON.parse(readFileSync(PATH, "utf8")) as Store;
    return { transactions: Array.isArray(raw.transactions) ? raw.transactions : [] };
  } catch {
    return empty();
  }
}

function write(store: Store) {
  mkdirSync(join(ROOT_DIR, "data"), { recursive: true });
  writeFileSync(PATH, JSON.stringify(store, null, 2));
}

export function recordTx(tx: StoredTx) {
  const store = read();
  if (store.transactions.some((row) => row.id === tx.id)) return tx;
  store.transactions.push(tx);
  write(store);
  return tx;
}

export function listTxs(): StoredTx[] {
  return [...read().transactions].sort((a, b) => b.at.localeCompare(a.at));
}

export function txsForAgent(agentId: string) {
  return listTxs().filter((row) => row.agentId === agentId);
}
