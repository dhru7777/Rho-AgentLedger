import type { CommerceOrder } from "../commerce/types.js";
import type { RhoTransaction } from "../rho/types.js";

export const AGENT_IDS = ["sales", "support", "research"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_NAMES: Record<AgentId, string> = {
  sales: "Shopping Agent",
  support: "Support Agent",
  research: "Research Agent",
};

const TAG = /agent:(sales|support|research)\b/i;
const ORDER_TAG = /order:([A-Za-z0-9_-]+)/;

export function agentFromText(text?: string): AgentId | null {
  if (!text) return null;
  const m = text.match(TAG);
  return m ? (m[1].toLowerCase() as AgentId) : null;
}

export function orderIdFromText(text?: string): string | null {
  if (!text) return null;
  const m = text.match(ORDER_TAG);
  return m ? m[1] : null;
}

export function agentForOrder(order: CommerceOrder): AgentId {
  if (AGENT_IDS.includes(order.agentId as AgentId)) return order.agentId as AgentId;
  return agentFromText(`${order.agentId} ${order.agentName}`) || "sales";
}

export function agentForTx(tx: RhoTransaction): AgentId | null {
  return agentFromText(tx.memo) || agentFromText(tx.note);
}
