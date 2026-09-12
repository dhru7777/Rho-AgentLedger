/** Rho v1 transaction shape we actually join on. Live REST and fixtures share this type. */

export type RhoAmount = {
  amount: number;
  currency: string;
};

export type RhoTransaction = {
  id: string;
  money_movement_id: string;
  account_id: string;
  account_name: string;
  status: "pending" | "settled" | "failed" | "awaiting_approval";
  transaction_type: string;
  amount: RhoAmount;
  initiated_at: string;
  posted_at: string | null;
  counterparty_name: string;
  memo?: string;
  note?: string;
  source: "live" | "fixture";
};
