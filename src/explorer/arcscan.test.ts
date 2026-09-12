import { describe, expect, it } from "vitest";
import { amountToCents, mapBlockscoutTransfer, mapEtherscanTokentx } from "./arcscan.js";

const USDC = "0x3600000000000000000000000000000000000000";

describe("ArcScan mapping", () => {
  it("maps a live Blockscout USDC transfer without inventing fields", () => {
    const row = mapBlockscoutTransfer(
      {
        transaction_hash: "0x99f6de545a18d3b5933f8145d2af166c7a1e90d21e1f4d09299e692ec91e22f0",
        timestamp: "2026-09-12T02:34:01.000000Z",
        log_index: 3,
        from: { hash: "0xc375aa6ca6cec34fb006fa4941651ebecd6050ba" },
        to: { hash: "0x8a1F1A008fa88aC45155e6a884084fEbafe1F08c" },
        token: { symbol: "USDC", decimals: "6", address_hash: USDC },
        total: { decimals: "6", value: "4350000" },
      },
      USDC,
    );
    expect(row?.amountCents).toBe(435);
    expect(row?.hash).toMatch(/^0x99f6de54/);
    expect(row?.explorerUrl).toContain("/tx/0x99f6de54");
  });

  it("drops non-USDC token transfers instead of fabricating USDC", () => {
    const row = mapBlockscoutTransfer(
      {
        transaction_hash: "0xabc",
        token: { symbol: "EURC", address_hash: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" },
        total: { value: "100", decimals: "6" },
      },
      USDC,
    );
    expect(row).toBeNull();
  });

  it("maps an Etherscan-compatible tokentx row", () => {
    const row = mapEtherscanTokentx(
      {
        hash: "0x111",
        timeStamp: "1757644441",
        from: "0xc375aa6ca6cec34fb006fa4941651ebecd6050ba",
        to: "0x7976bb37afe8dbdd9df6dc25212255616549aaf7",
        value: "10000",
        tokenDecimal: "6",
        tokenSymbol: "USDC",
        contractAddress: USDC,
        logIndex: "1",
      },
      USDC,
    );
    expect(row?.amountCents).toBe(1);
    expect(amountToCents("1000000", 6)).toBe(100);
  });
});
