/** Layer 1 — platform-agnostic commerce orders. Rho and the scorecard never import Shopify or x402. */

export type CommercePlatform = "shopify-ucp" | "x402" | "stan" | "fixture";

export type CommerceOrder = {
  id: string;
  platform: CommercePlatform;
  agentId: string;
  agentName: string;
  title: string;
  amountCents: number;
  currency: "USD";
  createdAt: string;
  reference: string;
};
