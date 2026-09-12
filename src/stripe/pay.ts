import { config, stripeReady } from "../config.js";
import { buyerStripe, sellerStripe } from "./client.js";

export type StripeReceipt = {
  status: "paid" | "error";
  error?: string;
  amountCents: number;
  currency: "usd";
  provider: "stripe";
  mode: "test";
  connectEnabled: boolean;
  paymentIntentId?: string;
  chargeId?: string;
  transferId?: string | null;
  paymentStatus?: string;
  card: { brand: string; last4: string };
  dashboardUrl?: string;
  sellerPaymentIntentId?: string;
  sellerDashboardUrl?: string;
  connectError?: string;
};

function cents(usd: number) {
  return Math.round(usd * 100);
}

async function sellerReceipt(amountCents: number, offerId: string, offerName: string, buyerPi: string) {
  const client = sellerStripe();
  if (!client) return {};
  try {
    const intent = await client.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      payment_method: "pm_card_visa",
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        demo: "agentledger",
        type: "seller_receipt",
        offerId,
        offerName,
        buyerPaymentIntentId: buyerPi,
      },
    });
    return {
      sellerPaymentIntentId: intent.id,
      sellerDashboardUrl: `https://dashboard.stripe.com/test/payments/${intent.id}`,
    };
  } catch (err) {
    return { sellerReceiptError: err instanceof Error ? err.message : String(err) };
  }
}

export async function executeStripePayment(input: {
  amountUsd: number;
  offerId: string;
  offerName: string;
  agentId?: string;
}): Promise<StripeReceipt> {
  const client = buyerStripe();
  const amountCents = cents(input.amountUsd);
  const card = { brand: "visa", last4: "4242" };
  if (!client) {
    return { status: "error", error: "STRIPE_SECRET_KEY is not set", amountCents, currency: "usd", provider: "stripe", mode: "test", connectEnabled: false, card };
  }

  const sellerId = config.stripe.sellerAccountId;
  const params = (useConnect: boolean) => ({
    amount: amountCents,
    currency: "usd" as const,
    payment_method: config.stripe.buyerPaymentMethod,
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" as const },
    metadata: { demo: "agentledger", offerId: input.offerId, offerName: input.offerName },
    ...(useConnect && sellerId ? { transfer_data: { destination: sellerId } } : {}),
  });

  let connectError: string | undefined;
  let usedConnect = Boolean(sellerId);
  let intent;
  try {
    intent = await client.paymentIntents.create(params(true));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (sellerId && /destination|acct_|Connect/i.test(msg)) {
      connectError = msg;
      usedConnect = false;
      try {
        intent = await client.paymentIntents.create(params(false));
      } catch (err2) {
        return {
          status: "error",
          error: err2 instanceof Error ? err2.message : String(err2),
          connectError,
          amountCents,
          currency: "usd",
          provider: "stripe",
          mode: "test",
          connectEnabled: false,
          card,
        };
      }
    } else {
      return {
        status: "error",
        error: msg,
        amountCents,
        currency: "usd",
        provider: "stripe",
        mode: "test",
        connectEnabled: false,
        card,
      };
    }
  }

  if (!intent || !["succeeded", "requires_capture"].includes(intent.status)) {
    return {
      status: "error",
      error: `PaymentIntent status: ${intent?.status ?? "missing"}`,
      paymentIntentId: intent?.id,
      amountCents,
      currency: "usd",
      provider: "stripe",
      mode: "test",
      connectEnabled: usedConnect,
      card,
    };
  }

  const chargeId =
    typeof intent.latest_charge === "string"
      ? intent.latest_charge
      : intent.latest_charge?.id;
  const transferId = usedConnect ? (intent.transfer_data as { transfer?: string } | null)?.transfer || null : null;
  let sellerBits: { sellerPaymentIntentId?: string; sellerDashboardUrl?: string } = {};
  if (config.stripe.sellerSecretKey && !usedConnect) {
    sellerBits = await sellerReceipt(amountCents, input.offerId, input.offerName, intent.id);
  }

  const receipt: StripeReceipt = {
    status: "paid",
    amountCents,
    currency: "usd",
    provider: "stripe",
    mode: "test",
    connectEnabled: usedConnect,
    connectError,
    paymentIntentId: intent.id,
    chargeId,
    transferId,
    paymentStatus: intent.status,
    card,
    dashboardUrl: `https://dashboard.stripe.com/test/payments/${intent.id}`,
    sellerPaymentIntentId: sellerBits.sellerPaymentIntentId,
    sellerDashboardUrl: sellerBits.sellerDashboardUrl,
  };

  return receipt;
}

export async function listBuyerCharges(limit = 8) {
  const client = buyerStripe();
  if (!client) return [];
  const charges = await client.charges.list({ limit });
  return charges.data.map((ch) => ({
    id: ch.id,
    amountCents: ch.amount,
    currency: (ch.currency || "usd").toUpperCase(),
    status: ch.status,
    created: ch.created,
    paymentIntentId: typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id,
    cardBrand: ch.payment_method_details?.card?.brand || "visa",
    cardLast4: ch.payment_method_details?.card?.last4 || "4242",
  }));
}

export async function listSellerCharges(limit = 8) {
  const client = sellerStripe();
  if (!client) return [];
  const charges = await client.charges.list({ limit });
  return charges.data.map((ch) => ({
    id: ch.id,
    amountCents: ch.amount,
    currency: (ch.currency || "usd").toUpperCase(),
    status: ch.status,
    created: ch.created,
    paymentIntentId: typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id,
  }));
}

export function stripeStatus() {
  return {
    configured: stripeReady(),
    connect: Boolean(config.stripe.sellerAccountId),
    sellerAccount: Boolean(config.stripe.sellerSecretKey.startsWith("sk_test_")),
  };
}
