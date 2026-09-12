import Stripe from "stripe";
import { config, stripeReady } from "../config.js";

export function buyerStripe(): Stripe | null {
  if (!stripeReady()) return null;
  return new Stripe(config.stripe.secretKey);
}

export function sellerStripe(): Stripe | null {
  const key = config.stripe.sellerSecretKey;
  if (!key.startsWith("sk_test_")) return null;
  return new Stripe(key);
}
