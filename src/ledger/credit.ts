import { agentWallets } from "../circle/wallets.js";
import { listTxs, type StoredTx } from "../db/store.js";
import type { TrustSignals } from "../types.js";
import { AGENT_IDS, AGENT_NAMES, type AgentId } from "./attribution.js";

export type CreditBlock = {
  id: "character" | "capacity" | "collateral" | "condition";
  name: string;
  score: number;
  detail: string;
};

export type FicoBand = "Poor" | "Fair" | "Good" | "Very Good" | "Exceptional";

export function ficoFrom4c(score: number) {
  const n = Math.max(1, Math.min(99, Number(score) || 1));
  return Math.round(300 + (n / 99) * 550);
}

export function ficoBand(fico: number): FicoBand {
  if (fico >= 800) return "Exceptional";
  if (fico >= 740) return "Very Good";
  if (fico >= 670) return "Good";
  if (fico >= 580) return "Fair";
  return "Poor";
}

export type AgentCredit = {
  agentId: AgentId;
  name: string;
  blocks: CreditBlock[];
  score: number;
  fico: number;
  ficoBand: FicoBand;
  creditLineUsd: number;
  prepaidToday: true;
  thesis: string;
};

function clamp(n: number, lo = 1, hi = 99) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function character(txs: StoredTx[], trust: TrustSignals | null, matchRate: number): CreditBlock {
  const live = trust?.source === "erc-8004" && Boolean(trust.identityVerified);
  const identity = live ? 24 : 6;
  const feedbackPts = Math.min(28, (trust?.reputationSignals || 0) * 3);
  const validationPts = Math.min(18, (trust?.validationSignals || 0) * 8);
  const failures = Math.max(0, 12 - (trust?.recentFailures || 0) * 6);
  const settled = txs.filter((t) => /succeed|paid|success|captured/i.test(t.status)).length;
  const total = txs.length || 1;
  const behavior = (settled / total) * 8 + matchRate * 8;
  const score = clamp(identity + feedbackPts + validationPts + failures + behavior);
  return {
    id: "character",
    name: "Character",
    score,
    detail: live
      ? `${trust?.name || "Agent"} · ${trust?.reputationSignals || 0} on-chain feedback · ${trust?.validationSignals || 0} validations`
      : "No live ERC-8004 character · prepaid only",
  };
}

function capacity(txs: StoredTx[], revenueCents: number, costCents: number): CreditBlock {
  const volume = txs.reduce((n, t) => n + t.amountCents, 0);
  const roi = costCents > 0 ? revenueCents / costCents : revenueCents > 0 ? 4 : 0;
  const countPts = Math.min(35, Math.log10(txs.length + 1) * 28);
  const roiPts = Math.min(40, roi * 5);
  const volPts = Math.min(24, volume / 20000);
  const score = clamp(countPts + roiPts + volPts);
  return {
    id: "capacity",
    name: "Capacity",
    score,
    detail: `${txs.length} autonomous payments · ${roi.toFixed(1)}x ROI on joined P&L`,
  };
}

function collateral(txs: StoredTx[], usdc: number): CreditBlock {
  const fiat = txs.filter((t) => t.rail === "fiat").length;
  const crypto = txs.filter((t) => t.rail === "crypto").length;
  const floatPts = Math.min(45, usdc);
  const dualPts = fiat && crypto ? 25 : fiat || crypto ? 12 : 0;
  const histPts = Math.min(30, (fiat + crypto) * 2);
  const score = clamp(floatPts + dualPts + histPts);
  return {
    id: "collateral",
    name: "Collateral",
    score,
    detail: `Prepaid float ${usdc.toFixed(0)} USDC · Stripe ${fiat} · Circle ${crypto}`,
  };
}

function condition(matchRate: number, rhoLive: boolean, dualRail: boolean): CreditBlock {
  const matchPts = matchRate * 50;
  const rhoPts = rhoLive ? 30 : 18;
  const railPts = dualRail ? 20 : 8;
  const score = clamp(matchPts + rhoPts + railPts);
  return {
    id: "condition",
    name: "Condition",
    score,
    detail: rhoLive
      ? "Rho live settlements are the underwriting condition"
      : "Rho fixture feed · same join logic when a token arrives",
  };
}

export function scoreCredit(input: {
  agentId: AgentId;
  txs: StoredTx[];
  trust: TrustSignals | null;
  matchRate: number;
  revenueCents: number;
  costCents: number;
  usdc: number;
  rhoLive: boolean;
}): AgentCredit {
  const dualRail = input.txs.some((t) => t.rail === "fiat") && input.txs.some((t) => t.rail === "crypto");
  const blocks = [
    character(input.txs, input.trust, input.matchRate),
    capacity(input.txs, input.revenueCents, input.costCents),
    collateral(input.txs, input.usdc),
    condition(input.matchRate, input.rhoLive, dualRail),
  ];
  const score = clamp(blocks[0].score * 0.3 + blocks[1].score * 0.25 + blocks[2].score * 0.25 + blocks[3].score * 0.2);
  const fico = ficoFrom4c(score);
  const creditLineUsd = Math.round(score * 25);
  return {
    agentId: input.agentId,
    name: AGENT_NAMES[input.agentId],
    blocks,
    score,
    fico,
    ficoBand: ficoBand(fico),
    creditLineUsd,
    prepaidToday: true,
    thesis: `Today every agent payment is prepaid. A ${score} 4C file supports a $${creditLineUsd} universal credit line against Rho-observed activity — not a storefront claim.`,
  };
}

export async function creditForAgents(input: {
  matchRateByAgent: Record<AgentId, number>;
  revenueByAgent: Record<AgentId, number>;
  costByAgent: Record<AgentId, number>;
  buyerTrust: TrustSignals | null;
  sellerTrust: TrustSignals | null;
  rhoLive: boolean;
}) {
  const txs = listTxs();
  let usdc = 0;
  try {
    const wallets = await agentWallets();
    usdc = Number(wallets.buyer.usdc || 0);
  } catch {
    usdc = 0;
  }
  return AGENT_IDS.map((id) =>
    scoreCredit({
      agentId: id,
      txs: txs.filter((t) => t.agentId === id),
      trust: id === "sales" ? input.buyerTrust : input.sellerTrust,
      matchRate: input.matchRateByAgent[id] || 0,
      revenueCents: input.revenueByAgent[id] || 0,
      costCents: input.costByAgent[id] || 0,
      usdc: id === "sales" ? usdc : Math.max(0, usdc * 0.4),
      rhoLive: input.rhoLive,
    }),
  );
}
