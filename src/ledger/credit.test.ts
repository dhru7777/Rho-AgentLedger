import { describe, expect, it } from "vitest";
import { scoreCredit } from "./credit.js";

describe("4C credit", () => {
  it("raises the credit line when identity, volume, and Rho matches improve", () => {
    const thin = scoreCredit({
      agentId: "research",
      txs: [],
      trust: {
        agentId: "0",
        name: "Research",
        identityVerified: false,
        reputationSignals: 0,
        validationSignals: 0,
        recentFailures: 3,
        registry: "x",
      },
      matchRate: 0.2,
      revenueCents: 120000,
      costCents: 100000,
      usdc: 5,
      rhoLive: false,
    });
    const strong = scoreCredit({
      agentId: "sales",
      txs: [
        {
          id: "1",
          at: "2026-09-01T00:00:00.000Z",
          agentId: "sales",
          role: "buyer",
          rail: "crypto",
          direction: "out",
          amountCents: 899,
          currency: "USDC",
          status: "SUCCESS",
          title: "chocolates",
          reference: "a",
        },
        {
          id: "2",
          at: "2026-09-02T00:00:00.000Z",
          agentId: "sales",
          role: "buyer",
          rail: "fiat",
          direction: "out",
          amountCents: 1299,
          currency: "USD",
          status: "succeeded",
          title: "chocolates",
          reference: "b",
        },
      ],
      trust: {
        agentId: "9638",
        name: "Sales",
        identityVerified: true,
        reputationSignals: 4,
        validationSignals: 1,
        recentFailures: 0,
        registry: "x",
        source: "erc-8004",
        character: "watch",
      },
      matchRate: 1,
      revenueCents: 842000,
      costCents: 120000,
      usdc: 49,
      rhoLive: true,
    });
    expect(strong.score).toBeGreaterThan(thin.score);
    expect(strong.creditLineUsd).toBeGreaterThan(thin.creditLineUsd);
    expect(strong.blocks.map((b) => b.id)).toEqual(["character", "capacity", "collateral", "condition"]);
    expect(strong.fico).toBeGreaterThan(thin.fico);
    expect(strong.ficoBand).toBeTruthy();
    expect(strong.blocks.find((b) => b.id === "collateral")?.detail).not.toMatch(/Circle|fixture/i);
    expect(strong.blocks.find((b) => b.id === "condition")?.detail).not.toMatch(/fixture/i);
    expect(strong.thesis).not.toMatch(/—|fixture|Circle/i);
    expect(thin.blocks.find((b) => b.id === "condition")?.detail).not.toMatch(/fixture/i);
  });
});
