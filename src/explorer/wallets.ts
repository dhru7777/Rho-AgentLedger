import { agentWallets } from "../circle/wallets.js";
import { config } from "../config.js";
import { directionFor, listUsdcTransfers, type ExplorerTransfer } from "./arcscan.js";

export type CryptoWalletTx = {
  hash: string;
  at: string;
  from: string;
  to: string;
  amountCents: number;
  currency: "USDC";
  direction: "in" | "out";
  status: "success";
  title: string;
  explorerUrl: string;
};

function publicTx(address: string, row: ExplorerTransfer): CryptoWalletTx {
  const direction = directionFor(address, row);
  const peer = direction === "out" ? row.to : row.from;
  return {
    hash: row.hash,
    at: row.at,
    from: row.from,
    to: row.to,
    amountCents: row.amountCents,
    currency: "USDC",
    direction,
    status: "success",
    title: `USDC ${direction === "out" ? "to" : "from"} ${peer.slice(0, 6)}…${peer.slice(-4)}`,
    explorerUrl: row.explorerUrl,
  };
}

export async function cryptoWallet(role: "buyer" | "seller") {
  const wallets = await agentWallets();
  const wallet = role === "buyer" ? wallets.buyer : wallets.seller;
  const address = wallet.address;
  const feed = await listUsdcTransfers(address);
  return {
    role,
    provider: "arcscan" as const,
    chain: config.arc.name,
    chainId: config.arc.chainId,
    explorer: feed.explorer,
    address,
    usdc: wallet.usdc,
    source: wallet.source,
    configured: Boolean(address?.startsWith("0x")),
    etherscanKey: Boolean(process.env.ETHERSCAN_API_KEY || process.env.ARCSCAN_API_KEY),
    recentTransfers: feed.transfers.slice(0, 12).map((row) => publicTx(address, row)),
    errors: feed.error ? [feed.error] : [],
  };
}

export async function buyerCryptoWallet() {
  return cryptoWallet("buyer");
}

export async function sellerCryptoWallet() {
  return cryptoWallet("seller");
}
