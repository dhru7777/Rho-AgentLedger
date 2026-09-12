import { listOrders, recordOrderFromReceipt, seedOrders } from "../commerce/adapter.js";
import { fixtureCohort } from "../rho/fixtures.js";
import { listRhoTransactions, recordMirroredSettlement, rhoFeedMode } from "../rho/client.js";
import type { Receipt } from "../types.js";
import { AGENT_IDS, AGENT_NAMES, agentForTx, type AgentId } from "./attribution.js";
import { reconcile, type LedgerMatch } from "./reconcile.js";

let seeded = false;

function ensureSeed() {
  if (seeded) return;
  seedOrders(fixtureCohort().orders);
  seeded = true;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function trustScore(roi: number, matchRate: number) {
  const roiPts = Math.min(40, roi * 5);
  const matchPts = matchRate * 40;
  return Math.round(clamp(20 + roiPts + matchPts, 1, 99));
}

export type AgentCard = {
  agentId: AgentId;
  name: string;
  revenueCents: number;
  costCents: number;
  roi: number;
  trust: number;
  matched: number;
  orders: number;
  question: string;
};

export function ingestReceipt(receipt: Receipt) {
  ensureSeed();
  const order = recordOrderFromReceipt(receipt);
  if (!order) return null;
  recordMirroredSettlement(order);
  return order;
}

export async function buildScorecard() {
  ensureSeed();
  const feed = await listRhoTransactions();
  const orders = listOrders();
  const matches = reconcile(orders, feed.transactions);
  const cards = AGENT_IDS.map((id) => cardFor(id, matches, feed.transactions));
  const winner = [...cards].sort((a, b) => b.trust - a.trust)[0];
  return {
    mode: feed.mode,
    liveError: feed.liveError || null,
    generatedAt: new Date().toISOString(),
    question: "Which agent should I trust with more money?",
    winner: winner
      ? { agentId: winner.agentId, name: winner.name, trust: winner.trust }
      : null,
    agents: cards,
    matches: matches.map(publicMatch),
    rhoCount: feed.transactions.length,
  };
}

function cardFor(id: AgentId, matches: LedgerMatch[], txs: Awaited<ReturnType<typeof listRhoTransactions>>["transactions"]): AgentCard {
  const mine = matches.filter((row) => row.agentId === id);
  const revenueCents = mine.reduce((n, row) => n + row.order.amountCents, 0);
  const costCents = txs
    .filter((tx) => tx.status === "settled" && tx.amount.amount < 0 && agentForTx(tx) === id)
    .reduce((n, tx) => n + Math.abs(tx.amount.amount), 0);
  const matched = mine.filter((row) => row.settlement).length;
  const matchRate = mine.length ? matched / mine.length : 0;
  const roi = costCents > 0 ? revenueCents / costCents : revenueCents > 0 ? 99 : 0;
  const trust = trustScore(roi, matchRate);
  return {
    agentId: id,
    name: AGENT_NAMES[id],
    revenueCents,
    costCents,
    roi: Number(roi.toFixed(2)),
    trust,
    matched,
    orders: mine.length,
    question: trust >= 85 ? "Give this agent more budget." : trust >= 70 ? "Hold budget steady." : "Do not increase budget.",
  };
}

function publicMatch(row: LedgerMatch) {
  return {
    orderId: row.order.id,
    title: row.order.title,
    agentId: row.agentId,
    amountCents: row.order.amountCents,
    kind: row.kind,
    rhoId: row.settlement?.id || null,
    postedAt: row.settlement?.posted_at || null,
    source: row.settlement?.source || null,
  };
}
