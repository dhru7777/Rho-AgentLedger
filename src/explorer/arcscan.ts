/** Live Arc USDC history. ArcScan is Etherscan/Blockscout compatible; Arc Testnet is not on etherscan.io. */
import { config } from "../config.js";

export type ExplorerTransfer = {
  hash: string;
  logIndex: number;
  at: string;
  from: string;
  to: string;
  amountAtomic: string;
  decimals: number;
  amountCents: number;
  tokenSymbol: string;
  tokenAddress: string;
  explorerUrl: string;
  source: "arcscan";
};

type BlockscoutToken = {
  symbol?: string | null;
  name?: string | null;
  decimals?: string | number | null;
  address_hash?: string | null;
};

type BlockscoutItem = {
  transaction_hash?: string;
  timestamp?: string;
  log_index?: number | string;
  method?: string;
  from?: { hash?: string } | string;
  to?: { hash?: string } | string;
  token?: BlockscoutToken;
  total?: { value?: string; decimals?: string };
};

type EtherscanTokentx = {
  hash?: string;
  timeStamp?: string;
  from?: string;
  to?: string;
  value?: string;
  tokenDecimal?: string;
  tokenSymbol?: string;
  contractAddress?: string;
  logIndex?: string;
};

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "AgentLedger/1.0",
};

function explorerBase() {
  return (process.env.ARC_EXPLORER_URL || config.arc.explorer).replace(/\/$/, "");
}

function apiKey() {
  return process.env.ARCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "";
}

function addrOf(value: { hash?: string } | string | undefined) {
  if (!value) return "";
  return typeof value === "string" ? value : value.hash || "";
}

function sameAddr(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

export function amountToCents(atomic: string, decimals: number) {
  const n = Number(atomic);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n / 10 ** decimals) * 100);
}

export function mapBlockscoutTransfer(item: BlockscoutItem, usdc: string): ExplorerTransfer | null {
  const hash = item.transaction_hash || "";
  const tokenAddr = item.token?.address_hash || "";
  if (!hash || !sameAddr(tokenAddr, usdc)) return null;
  const decimals = Number(item.total?.decimals ?? item.token?.decimals ?? 6);
  const atomic = item.total?.value || "0";
  return {
    hash,
    logIndex: Number(item.log_index || 0),
    at: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
    from: addrOf(item.from),
    to: addrOf(item.to),
    amountAtomic: atomic,
    decimals: Number.isFinite(decimals) ? decimals : 6,
    amountCents: amountToCents(atomic, Number.isFinite(decimals) ? decimals : 6),
    tokenSymbol: item.token?.symbol || "USDC",
    tokenAddress: tokenAddr,
    explorerUrl: `${explorerBase()}/tx/${hash}`,
    source: "arcscan",
  };
}

export function mapEtherscanTokentx(row: EtherscanTokentx, usdc: string): ExplorerTransfer | null {
  const hash = row.hash || "";
  const tokenAddr = row.contractAddress || "";
  if (!hash || !sameAddr(tokenAddr, usdc)) return null;
  const decimals = Number(row.tokenDecimal || 6);
  const atomic = row.value || "0";
  const ts = Number(row.timeStamp || 0);
  return {
    hash,
    logIndex: Number(row.logIndex || 0),
    at: ts ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    from: row.from || "",
    to: row.to || "",
    amountAtomic: atomic,
    decimals: Number.isFinite(decimals) ? decimals : 6,
    amountCents: amountToCents(atomic, Number.isFinite(decimals) ? decimals : 6),
    tokenSymbol: row.tokenSymbol || "USDC",
    tokenAddress: tokenAddr,
    explorerUrl: `${explorerBase()}/tx/${hash}`,
    source: "arcscan",
  };
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`ArcScan ${res.status}`);
  return res.json() as Promise<unknown>;
}

async function fromBlockscout(address: string, usdc: string): Promise<ExplorerTransfer[]> {
  const url = `${explorerBase()}/api/v2/addresses/${address}/token-transfers?type=ERC-20`;
  const json = (await fetchJson(url)) as { items?: BlockscoutItem[] };
  const items = Array.isArray(json.items) ? json.items : [];
  return items.map((item) => mapBlockscoutTransfer(item, usdc)).filter((row): row is ExplorerTransfer => Boolean(row));
}

async function latestBlock(): Promise<number> {
  const res = await fetch(config.arc.rpcUrl, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json()) as { result?: string };
  const n = Number.parseInt(json.result || "0x0", 16);
  return Number.isFinite(n) ? n : 0;
}

async function fromEtherscanCompat(address: string, usdc: string): Promise<ExplorerTransfer[]> {
  const latest = await latestBlock();
  const endblock = latest || 99999999;
  const startblock = Math.max(0, endblock - 199_999);
  const params = new URLSearchParams({
    module: "account",
    action: "tokentx",
    address,
    contractaddress: usdc,
    startblock: String(startblock),
    endblock: String(endblock),
    page: "1",
    offset: "50",
    sort: "desc",
  });
  const key = apiKey();
  if (key) params.set("apikey", key);
  const json = (await fetchJson(`${explorerBase()}/api?${params}`)) as {
    status?: string;
    result?: EtherscanTokentx[] | string;
  };
  const rows = Array.isArray(json.result) ? json.result : [];
  return rows.map((row) => mapEtherscanTokentx(row, usdc)).filter((row): row is ExplorerTransfer => Boolean(row));
}

export async function listUsdcTransfers(address: string): Promise<{
  transfers: ExplorerTransfer[];
  explorer: string;
  error: string | null;
}> {
  const explorer = explorerBase();
  if (!address || !address.startsWith("0x")) {
    return { transfers: [], explorer, error: "no wallet address" };
  }
  const usdc = config.arc.usdc;
  try {
    const transfers = await fromBlockscout(address, usdc);
    if (transfers.length) return { transfers, explorer, error: null };
  } catch {
    /* fall through to Etherscan-compatible module=account */
  }
  try {
    const transfers = await fromEtherscanCompat(address, usdc);
    return { transfers, explorer, error: null };
  } catch (err) {
    return {
      transfers: [],
      explorer,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function directionFor(address: string, transfer: ExplorerTransfer): "in" | "out" {
  return sameAddr(transfer.from, address) ? "out" : "in";
}
