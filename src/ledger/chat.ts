import { chatText, openaiConfigured } from "../intent/openai.js";
import { buildScorecard } from "./scorecard.js";

export type ChatTurn = { role: "user" | "assistant"; content: string };

function compact(card: Awaited<ReturnType<typeof buildScorecard>>) {
  return {
    shoppingAgent: card.credit.find((a) => a.agentId === "sales") || null,
    supportAgent: card.credit.find((a) => a.agentId === "support") || null,
    researchAgent: card.credit.find((a) => a.agentId === "research") || null,
    merchantAgent: card.merchant,
    identities: {
      shopping: card.identities.buyer,
      merchant: card.identities.seller,
    },
    wallets: card.wallets,
    summary: card.summary,
    winner: card.winner,
    recentActivity: (card.transactions || []).slice(0, 15).map((t) => ({
      at: t.at,
      rail: t.rail,
      direction: t.direction,
      amount: t.amountCents / 100,
      currency: t.currency,
      title: t.title,
      agent: t.agentId,
    })),
    rhoSettlements: (card.rhoTransactions || []).slice(0, 12).map((t) => ({
      id: t.id,
      amount: t.amountCents / 100,
      counterparty: t.counterparty,
      type: t.type,
      at: t.at,
    })),
    joins: (card.matches || []).map((m) => ({
      agent: m.agentId,
      title: m.title,
      amount: m.amountCents / 100,
      matched: Boolean(m.rhoId),
      rhoId: m.rhoId,
    })),
  };
}

function localAnswer(q: string, ctx: ReturnType<typeof compact>) {
  const shop = ctx.shoppingAgent;
  const merch = ctx.merchantAgent;
  const lower = q.toLowerCase();
  if (/merchant|seller|6832/.test(lower) && merch) {
    return `${merch.name} credit score is ${merch.fico} (${merch.ficoBand}). ERC-8004 #${ctx.identities.merchant?.agentId} is ${ctx.identities.merchant?.character || "missing"} with ${ctx.identities.merchant?.reputationSignals || 0} feedback and ${ctx.identities.merchant?.validationSignals || 0} validations.`;
  }
  if (/shop|9638|credit|fico|who|budget|trust|best/.test(lower) && shop) {
    return `${shop.name} leads with a ${shop.fico} ${shop.ficoBand} file (4C ${shop.score}) and a suggested prepaid line of $${shop.creditLineUsd}. Character is ${ctx.identities.shopping?.character || "watch"}: ${ctx.identities.shopping?.reputationSignals || 0} feedback, ${ctx.identities.shopping?.validationSignals || 0} independent validations.`;
  }
  const s = ctx.summary;
  return `Prepaid wallets ${s?.prepaidUsd != null ? `$${Number(s.prepaidUsd).toFixed(2)}` : "—"}. Suggested line $${s?.creditLineUsd || 0}. ${s?.matched || 0} Rho joins, ${s?.cryptoCount || 0} ArcScan USDC moves, ${s?.fiatCount || 0} Stripe charges. Ask who should get more budget, or about Shopping vs Merchant character.`;
}

export async function answerLedgerChat(question: string, history: ChatTurn[] = []) {
  const q = String(question || "").trim();
  if (!q) return { answer: "Ask anything about the scoreboard: credit, character, wallets, or unmatched claims.", source: "local" as const };
  const card = await buildScorecard();
  const ctx = compact(card);
  if (openaiConfigured() && process.env.VITEST !== "true") {
    try {
      const answer = await chatText({
        system:
          "You are the AgentLedger CFO copilot. Answer only from the JSON scoreboard. Shopping Agent is the buyer (#9638). Merchant Agent is the seller (#6832). Credit scores are FICO-like 300–850 mapped from the 4C file. Do not invent transactions, hashes, or validations. Do not say fixture. If Rho is connected, say live settlements; otherwise say ledger settlements. Be concise. Do not use em dashes.",
        messages: [
          ...history.slice(-6),
          { role: "user", content: `SCOREBOARD:\n${JSON.stringify(ctx)}\n\nQUESTION:\n${q}` },
        ],
      });
      if (answer) return { answer, source: "openai" as const };
    } catch {
      /* fall through */
    }
  }
  return { answer: localAnswer(q, ctx), source: "local" as const };
}
