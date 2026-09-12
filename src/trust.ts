/** Live ERC-8004 identity from 8004scan. Missing identity fails closed. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, ROOT_DIR } from "./config.js";
import type { TrustSignals } from "./types.js";

const FILE = join(ROOT_DIR, "data", "trust.json");
const CACHE_MS = 60_000;

type TrustState = { sellerRecentFailures: number };
type ScanAgent = {
  token_id?: string;
  name?: string | null;
  is_active?: boolean;
  is_verified?: boolean;
  star_count?: number;
  total_feedbacks?: number;
  total_validations?: number;
  successful_validations?: number;
  x402_supported?: boolean;
  contract_address?: string;
  chain_id?: number;
  ens?: string | null;
};

const cache = new Map<string, { at: number; agent: ScanAgent | null }>();

function load(): TrustState {
  try {
    if (!existsSync(FILE)) return { sellerRecentFailures: 0 };
    return JSON.parse(readFileSync(FILE, "utf8")) as TrustState;
  } catch {
    return { sellerRecentFailures: 0 };
  }
}

function save(state: TrustState) {
  mkdirSync(join(ROOT_DIR, "data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

const SCAN_SLUGS: Record<number, string> = {
  1: "ethereum",
  11155111: "sepolia",
  8453: "base",
  84532: "base-sepolia",
};

function scanWebHost() {
  const host = config.identity.scanWeb.replace(/\/$/, "");
  if (config.identity.chainId !== 11155111) return host;
  if (host.includes("testnet.8004scan.io")) return host;
  if (host.includes("8004scan.io")) return "https://testnet.8004scan.io";
  return host;
}

export function scanUrl(tokenId: string) {
  const slug = SCAN_SLUGS[config.identity.chainId] || String(config.identity.chainId);
  return `${scanWebHost()}/agents/${slug}/${tokenId}`;
}

export function characterFrom8004(input: {
  identityVerified: boolean;
  reputationSignals: number;
  validationSignals: number;
  recentFailures: number;
  x402Supported: boolean;
  isActive: boolean;
}): { character: TrustSignals["character"]; characterDetail: string } {
  if (!input.identityVerified) {
    return { character: "missing", characterDetail: "No live ERC-8004 record · cannot underwrite character" };
  }
  if (!input.isActive) {
    return { character: "thin", characterDetail: "ERC-8004 identity exists but is inactive" };
  }
  if (input.recentFailures >= 3) {
    return {
      character: "thin",
      characterDetail: `${input.recentFailures} recent failures · prepaid only`,
    };
  }
  if (input.reputationSignals >= 5 && input.validationSignals >= 1 && input.recentFailures === 0) {
    return {
      character: "good",
      characterDetail: `${input.reputationSignals} on-chain feedback · ${input.validationSignals} independent validations${input.x402Supported ? " · x402" : ""}`,
    };
  }
  if (input.reputationSignals > 0 || input.validationSignals > 0 || input.x402Supported) {
    return {
      character: "watch",
      characterDetail: `${input.reputationSignals} feedback · ${input.validationSignals} validations · not independently validated yet`,
    };
  }
  return { character: "thin", characterDetail: "Identity live · no feedback or validations yet" };
}

export function mapScanAgent(
  agent: ScanAgent | null,
  role: "buyer" | "seller",
  recentFailures = 0,
  mode: "live" | "adapter" = "adapter",
): TrustSignals {
  void mode;
  const tokenId = role === "buyer" ? config.identity.buyerAgentId : config.identity.sellerAgentId;
  const resolvedId = String(agent?.token_id || tokenId);
  const fallbackName = role === "buyer" ? config.identity.buyerName : config.identity.sellerName;
  const live = Boolean(agent && (agent.token_id || agent.is_active != null));
  const feedbacks = Number(agent?.total_feedbacks ?? 0);
  const validations = Number(agent?.successful_validations ?? agent?.total_validations ?? 0);
  const isActive = live ? agent?.is_active !== false : false;
  const identityVerified = live && isActive;
  const x402Supported = live ? Boolean(agent?.x402_supported) : false;
  const file = characterFrom8004({
    identityVerified,
    reputationSignals: feedbacks,
    validationSignals: validations,
    recentFailures,
    x402Supported,
    isActive,
  });
  return {
    agentId: resolvedId,
    name: fallbackName,
    identityVerified,
    reputationSignals: feedbacks,
    validationSignals: validations,
    recentFailures,
    registry: agent?.contract_address || config.identity.identityRegistry,
    source: live ? "erc-8004" : "adapter",
    scanUrl: scanUrl(resolvedId),
    x402Supported,
    chainId: agent?.chain_id || config.identity.chainId,
    isActive,
    publisherVerified: Boolean(agent?.is_verified),
    starCount: Number(agent?.star_count ?? 0),
    character: file.character,
    characterDetail: file.characterDetail,
  };
}

export async function fetchScanAgent(tokenId: string): Promise<ScanAgent | null> {
  const key = `${config.identity.chainId}:${tokenId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.agent;
  const bases = Array.from(
    new Set([
      "https://8004scan.io/api/v1/public",
      "https://testnet.8004scan.io/api/v1/public",
      config.identity.scanApi.replace(/\/$/, ""),
    ]),
  );
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/agents/${config.identity.chainId}/${tokenId}`, {
        headers: { Accept: "application/json", "User-Agent": "AgentLedger/1.0" },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { success?: boolean; data?: ScanAgent };
      const agent = json.success === false ? null : json.data || null;
      if (!agent) continue;
      cache.set(key, { at: Date.now(), agent });
      return agent;
    } catch {
      continue;
    }
  }
  cache.set(key, { at: Date.now(), agent: null });
  return null;
}

export function getSellerTrust(): TrustSignals {
  return mapScanAgent(null, "seller", load().sellerRecentFailures);
}

export function getBuyerTrust(): TrustSignals {
  return mapScanAgent(null, "buyer", 0);
}

export async function loadSellerTrust(): Promise<TrustSignals> {
  const agent = await fetchScanAgent(config.identity.sellerAgentId);
  return mapScanAgent(agent, "seller", load().sellerRecentFailures, agent ? "live" : "adapter");
}

export async function loadBuyerTrust(): Promise<TrustSignals> {
  const agent = await fetchScanAgent(config.identity.buyerAgentId);
  return mapScanAgent(agent, "buyer", 0, agent ? "live" : "adapter");
}

export function recordSellerFailure() {
  const state = load();
  state.sellerRecentFailures += 1;
  save(state);
}

export function recordSellerSuccess() {
  const state = load();
  if (state.sellerRecentFailures > 0) {
    state.sellerRecentFailures = Math.max(0, state.sellerRecentFailures - 1);
    save(state);
  }
}

/** Normalize ERC-8004 into policy signals. Never treat reputation as one score. */
export function toPolicySignals(trust: TrustSignals) {
  return {
    identityVerified: trust.identityVerified,
    reputationSignals: trust.reputationSignals,
    validationSignals: trust.validationSignals,
    recentFailures: trust.recentFailures,
    x402Supported: Boolean(trust.x402Supported),
  };
}
