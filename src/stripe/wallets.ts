import { config, stripeReady } from "../config.js";
import { listBuyerCharges, listSellerCharges } from "./pay.js";

export async function buyerFiatWallet() {
  const configured = stripeReady();
  let recentCharges: Awaited<ReturnType<typeof listBuyerCharges>> = [];
  let errors: string[] = [];
  if (configured) {
    try {
      recentCharges = await listBuyerCharges(8);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    role: "buyer" as const,
    provider: "stripe",
    mode: "test",
    configured,
    card: { brand: "visa", last4: "4242", paymentMethodId: config.stripe.buyerPaymentMethod },
    recentCharges,
    errors,
  };
}

export async function sellerFiatWallet() {
  const sellerKey = Boolean(config.stripe.sellerSecretKey.startsWith("sk_test_"));
  const connect = Boolean(config.stripe.sellerAccountId);
  const configured = sellerKey || connect;
  let recentCharges: Awaited<ReturnType<typeof listSellerCharges>> = [];
  let errors: string[] = [];
  if (sellerKey) {
    try {
      recentCharges = await listSellerCharges(8);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    role: "seller" as const,
    provider: "stripe",
    mode: "test",
    configured,
    sellerAccountConfigured: sellerKey,
    connectEnabled: connect,
    sellerAccountId: config.stripe.sellerAccountId || null,
    recentCharges,
    errors,
  };
}
