# AgentLedger

Financial observability for autonomous commerce agents. Built for **LOCK IN Hack** (Rho, Sep 12–13 2026).

Commerce platforms report what was sold. Rho reports what actually settled. AgentLedger joins the two feeds per agent and answers: **which agent should I trust with more money?**

The buyer/seller demo UI and payment rails are copied from [ysbobde2002/AgentARC](https://github.com/ysbobde2002/AgentARC) (Circle Agent Wallets, x402 nanopayments, AuthCapture). Layers 2–3 are new.

**Repo:** [https://github.com/dhru7777/Rho-AgentLedger](https://github.com/dhru7777/Rho-AgentLedger)

## Three layers

1. **Commerce** — Shopify UCP + Arc x402 receipts (`src/commerce`). Swappable later (Stan, Stripe, WooCommerce) without touching Rho.
2. **Financial truth** — Rho read-only transactions (`src/rho`). Live `GET /transactions` when `RHO_API_TOKEN` is set; otherwise a labeled 30-day fixture cohort.
3. **Intelligence** — join orders to settlements, then spend / revenue / ROI / trust (`src/ledger`).

Rho is read-only. No transfer authority is required for the demo.

## Run (no secrets)

```bash
npm install
npm start
```

Open [http://127.0.0.1:5180](http://127.0.0.1:5180). Adapter payment mode and **rho · fixture** are the worst-case path.

1. `Find me chocolates under $10` or `Get me the current ETH price. Spend up to $0.05`
2. Receipt appears on the buyer phone
3. **Ledger** tab and [/ledger](http://127.0.0.1:5180/ledger) update the agent scorecard

## Env

Copy `.env.example`. Nothing is required to boot.

**Rho (flip to live)**

- `RHO_API_TOKEN` — Settings → Configurations → Access Tokens (`accounts:read`, `transactions:read`)
- `RHO_API_BASE` — `https://rhoapi.rho.co/api/v1` or `https://rhoapi-sandbox.rho.co/api/v1`
- `RHO_ACCOUNT_ID` — optional
- `RHO_MODE` — `auto` (default), `live`, or `fixture`

**Circle (optional, from AgentARC)**

- `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID`
- `BUYER_WALLET_ID` / `SELLER_WALLET_ID` / `OPERATOR_WALLET_ID` and matching `_ADDRESS`

If a Rho token arrives mid-weekend: paste it, restart, no code change.

## API

- `GET /api/health`
- `GET /api/rho/health`
- `GET /api/ledger/scorecard`
- `POST /api/turn` · `POST /api/transactions` — AgentARC commerce loop

## Acknowledgments

Commerce rails from [AgentARC](https://github.com/ysbobde2002/AgentARC).
