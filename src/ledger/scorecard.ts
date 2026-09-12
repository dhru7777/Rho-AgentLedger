import { listOrders, recordOrderFromReceipt, seedOrders } from "../commerce/adapter.js";
import { config } from "../config.js";
import { listTxs, recordTx } from "../db/store.js";
import { directionFor, listUsdcTransfers } from "../explorer/arcscan.js";
import { fixtureCohort } from "../rho/fixtures.js";
import { listRhoTransactions, recordMirroredSettlement } from "../rho/client.js";
import type { RhoTransaction } from "../rho/types.js";
import { listBuyerCharges, listSellerCharges } from "../stripe/pay.js";
import { agentWallets } from "../circle/wallets.js";
import { loadBuyerTrust, loadSellerTrust } from "../trust.js";
import type { Receipt } from "../types.js";
import { AGENT_IDS, AGENT_NAMES, agentForTx, type AgentId } from "./attribution.js";
import { creditForAgents, ficoBand, ficoFrom4c } from "./credit.js";
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
  try {
    const [buyerCharges, sellerCharges] = await Promise.all([listBuyerCharges(20), listSellerCharges(20)]);
    for (const ch of buyerCharges) {
      recordTx({
        id: `stripe_buy_${ch.id}`,
        at: new Date((ch.created || 0) * 1000).toISOString(),
        agentId: "sales",
        role: "buyer",
        rail: "fiat",
        direction: "out",
        amountCents: ch.amountCents,
        currency: "USD",
        status: ch.status || "succeeded",
        title: "Stripe charge",
        reference: ch.id,
        explorerUrl: ch.paymentIntentId
          ? `https://dashboard.stripe.com/test/payments/${ch.paymentIntentId}`
          : undefined,
        stripePaymentIntentId: ch.paymentIntentId,
      });
    }
    for (const ch of sellerCharges) {
      recordTx({
        id: `stripe_sell_${ch.id}`,
        at: new Date((ch.created || 0) * 1000).toISOString(),
        agentId: "sales",
        role: "seller",
        rail: "fiat",
        direction: "in",
        amountCents: ch.amountCents,
        currency: "USD",
        status: ch.status || "succeeded",
        title: "Stripe receipt",
        reference: ch.id,
        explorerUrl: ch.paymentIntentId
          ? `https://dashboard.stripe.com/test/payments/${ch.paymentIntentId}`
          : undefined,
        stripePaymentIntentId: ch.paymentIntentId,
      });
    }
  } catch {
    /* Stripe history is optional when keys are missing */
  }
  try {
    const [buyerFeed, sellerFeed] = await Promise.all([
      listUsdcTransfers(config.circle.buyerWalletAddress),
      listUsdcTransfers(config.circle.sellerWalletAddress),
    ]);
    for (const { role, address, feed } of [
      { role: "buyer" as const, address: config.circle.buyerWalletAddress, feed: buyerFeed },
      { role: "seller" as const, address: config.circle.sellerWalletAddress, feed: sellerFeed },
    ]) {
      if (!address?.startsWith("0x")) continue;
      for (const row of feed.transfers.slice(0, 40)) {
        recordTx({
          id: `arc_${role}_${row.hash}_${row.logIndex}`,
          at: row.at,
          agentId: "sales",
          role,
          rail: "crypto",
          direction: directionFor(address, row),
          amountCents: row.amountCents,
          currency: "USDC",
          status: "success",
          title: "ArcScan USDC",
          reference: row.hash,
          explorerUrl: row.explorerUrl,
          circleTxHash: row.hash,
        });
      }
    }
  } catch {
    /* Explorer history is optional when ArcScan is unreachable */
  }
  const feed = await listRhoTransactions();
  const orders = listOrders();
  const matches = reconcile(orders, feed.transactions);
  const cards = AGENT_IDS.map((id) => cardFor(id, matches, feed.transactions));
  const matchRateByAgent = Object.fromEntries(
    AGENT_IDS.map((id) => {
      const mine = matches.filter((row) => row.agentId === id);
      return [id, mine.length ? mine.filter((row) => row.settlement).length / mine.length : 0];
    }),
  ) as Record<AgentId, number>;
  const revenueByAgent = Object.fromEntries(cards.map((c) => [c.agentId, c.revenueCents])) as Record<AgentId, number>;
  const costByAgent = Object.fromEntries(cards.map((c) => [c.agentId, c.costCents])) as Record<AgentId, number>;
  const [buyerTrust, sellerTrust, wallets] = await Promise.all([
    loadBuyerTrust(),
    loadSellerTrust(),
    agentWallets().catch(() => null),
  ]);
  const credit = await creditForAgents({
    matchRateByAgent,
    revenueByAgent,
    costByAgent,
    buyerTrust,
    sellerTrust,
    rhoLive: feed.mode === "live",
  });
  const winner = [...credit].sort((a, b) => b.score - a.score)[0];
  const merchantScore = Math.min(
    99,
    (sellerTrust.identityVerified ? 52 : 18) + Math.min(30, (sellerTrust.reputationSignals || 0) * 3),
  );
  const merchantFico = ficoFrom4c(merchantScore);
  const ledgerTxs = listTxs();
  const unmatched = matches.filter((row) => !row.settlement);
  return {
    mode: feed.mode,
    liveError: feed.liveError || null,
    generatedAt: new Date().toISOString(),
    winner: winner
      ? {
          agentId: winner.agentId,
          name: winner.name,
          trust: winner.score,
          fico: winner.fico,
          ficoBand: winner.ficoBand,
          creditLineUsd: winner.creditLineUsd,
        }
      : null,
    agents: cards,
    credit,
    identities: { buyer: buyerTrust, seller: sellerTrust },
    merchant: {
      name: "Merchant Agent",
      tokenId: sellerTrust.agentId,
      fico: merchantFico,
      ficoBand: ficoBand(merchantFico),
    },
    wallets: wallets
      ? {
          buyerUsdc: Number(wallets.buyer.usdc || 0),
          sellerUsdc: Number(wallets.seller.usdc || 0),
          buyerAddress: wallets.buyer.address,
          sellerAddress: wallets.seller.address,
        }
      : null,
    transactions: ledgerTxs,
    matches: matches.map(publicMatch),
    rhoTransactions: feed.transactions.map(publicRho),
    rhoCount: feed.transactions.length,
    summary: {
      prepaidUsd: Number(wallets?.buyer.usdc || 0),
      creditLineUsd: winner?.creditLineUsd || 0,
      outflowCents: ledgerTxs.filter((t) => t.direction === "out").reduce((n, t) => n + t.amountCents, 0),
      inflowCents: ledgerTxs.filter((t) => t.direction === "in").reduce((n, t) => n + t.amountCents, 0),
      matched: matches.filter((row) => row.settlement).length,
      unmatched: unmatched.length,
      unmatchedCents: unmatched.reduce((n, row) => n + row.order.amountCents, 0),
      matchedCents: matches.filter((row) => row.settlement).reduce((n, row) => n + row.order.amountCents, 0),
      cryptoCount: ledgerTxs.filter((t) => t.rail === "crypto").length,
      fiatCount: ledgerTxs.filter((t) => t.rail === "fiat").length,
      rhoCount: feed.transactions.length,
    },
    thesis: "Rho turns prepaid agent spend into a 4C credit file: character, capacity, collateral, condition.",
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
    postedAt: row.settlement?.posted_at || row.order.createdAt,
    source: row.settlement?.source || null,
    counterparty: row.order.title,
    createdAt: row.order.createdAt,
  };
}

function publicRho(tx: RhoTransaction) {
  return {
    id: tx.id,
    account: tx.account_name,
    status: tx.status,
    type: tx.transaction_type,
    amountCents: tx.amount.amount,
    currency: tx.amount.currency,
    at: tx.posted_at || tx.initiated_at,
    counterparty: tx.counterparty_name,
    memo: tx.memo || "",
    source: tx.source,
  };
}
