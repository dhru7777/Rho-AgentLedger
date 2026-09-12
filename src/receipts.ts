import { explorerTx, paymentMode } from "./config.js";
import { recordTx } from "./db/store.js";
import { ingestReceipt } from "./ledger/scorecard.js";
import type { Outcome, PaymentEvidence, Receipt, Rail, VerificationResult } from "./types.js";

const receipts = new Map<string, Receipt>();

export function buildReceipt(input: {
  id: string;
  buyerAgent: string;
  sellerAgent: string;
  service: string;
  amountUsd: number;
  rail: Rail;
  payment: PaymentEvidence;
  verification: VerificationResult | null;
  outcome: Outcome;
}): Receipt {
  const paymentTxHash =
    input.payment.captureTxHash ||
    input.payment.voidTxHash ||
    input.payment.settleTxHash ||
    input.payment.authorizeTxHash ||
    "pending";

  const stripe = input.payment.stripe;
  const fiat = input.payment.scheme === "stripe" || Boolean(stripe);
  const receipt: Receipt = {
    id: input.id,
    buyerAgent: input.buyerAgent,
    sellerAgent: input.sellerAgent,
    service: input.service,
    amount: input.amountUsd.toFixed(2),
    currency: fiat ? "USD" : "USDC",
    network: fiat ? "Stripe" : "Arc",
    rail: input.rail,
    paymentMode: paymentMode(),
    paymentTxHash,
    captureTxHash: input.payment.captureTxHash,
    voidTxHash: input.payment.voidTxHash,
    verification: {
      status: !input.verification
        ? "SKIPPED"
        : input.verification.verified
          ? "PASSED"
          : "FAILED",
    },
    outcome: input.outcome,
    createdAt: new Date().toISOString(),
    explorerUrl: stripe?.dashboardUrl || explorerTx(paymentTxHash),
  };
  receipts.set(receipt.id, receipt);
  ingestReceipt(receipt);
  if (receipt.outcome === "SUCCESS" || receipt.outcome === "HELD") {
    const amountCents = Math.round(Number(receipt.amount) * 100);
    const rail = fiat ? "fiat" : "crypto";
    recordTx({
      id: `buy_${receipt.id}`,
      at: receipt.createdAt,
      agentId: "sales",
      role: "buyer",
      rail,
      direction: "out",
      amountCents,
      currency: rail === "fiat" ? "USD" : "USDC",
      status: receipt.outcome,
      title: receipt.service,
      reference: receipt.id,
      explorerUrl: stripe?.dashboardUrl || receipt.explorerUrl,
      stripePaymentIntentId: stripe?.paymentIntentId,
      circleTxHash: stripe ? undefined : receipt.paymentTxHash,
    });
    recordTx({
      id: `sell_${receipt.id}`,
      at: receipt.createdAt,
      agentId: "sales",
      role: "seller",
      rail,
      direction: "in",
      amountCents,
      currency: rail === "fiat" ? "USD" : "USDC",
      status: receipt.outcome,
      title: receipt.service,
      reference: receipt.id,
      explorerUrl: stripe?.dashboardUrl || receipt.explorerUrl,
      stripePaymentIntentId: stripe?.paymentIntentId,
      circleTxHash: stripe ? undefined : receipt.paymentTxHash,
    });
  }
  return receipt;
}

export function getReceipt(id: string) {
  return receipts.get(id);
}

export function listReceipts() {
  return [...receipts.values()].reverse();
}

export function settledUsd() {
  return listReceipts()
    .filter((r) => r.outcome === "SUCCESS")
    .reduce((n, r) => n + Number(r.amount || 0), 0);
}
