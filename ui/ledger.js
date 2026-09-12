const money = (cents) =>
  (Number(cents || 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const usd = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const AGENT = { sales: "Shopping Agent", support: "Support Agent", research: "Research Agent" };
const chatHistory = [];

let score = null;
let bankFilter = "all";
let agentFilter = "all";
let identFilter = "all";
let bankQuery = "";

function when(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function agentFromMemo(memo) {
  const m = String(memo || "").match(/agent:(sales|support|research)/i);
  return m ? m[1].toLowerCase() : "sales";
}

function ficoBand(fico) {
  if (fico >= 800) return "Exceptional";
  if (fico >= 740) return "Very Good";
  if (fico >= 670) return "Good";
  if (fico >= 580) return "Fair";
  return "Poor";
}

function ficoMeter(fico, name) {
  const score = Math.max(300, Math.min(850, Number(fico) || 300));
  const band = ficoBand(score);
  const deg = 180 - ((score - 300) / 550) * 180;
  return `<div class="fico">
    <div class="fico-name">${esc(name || "")}</div>
    <div class="fico-dial">
      <svg viewBox="0 0 240 138" aria-hidden="true">
        <path d="M24 120 A96 96 0 0 1 72 42" fill="none" stroke="#8fd14f" stroke-width="22" stroke-linecap="butt" />
        <path d="M72 42 A96 96 0 0 1 118 28" fill="none" stroke="#c6e04a" stroke-width="22" />
        <path d="M118 28 A96 96 0 0 1 155 36" fill="none" stroke="#f0c419" stroke-width="22" />
        <path d="M155 36 A96 96 0 0 1 192 62" fill="none" stroke="#f08a1a" stroke-width="22" />
        <path d="M192 62 A96 96 0 0 1 216 120" fill="none" stroke="#e23b2f" stroke-width="22" />
        <text x="28" y="136" class="fico-cap">Poor</text>
        <text x="200" y="136" class="fico-cap">Exceptional</text>
      </svg>
      <div class="fico-needle" style="--deg:${deg.toFixed(1)}deg"></div>
      <div class="fico-hub"></div>
    </div>
    <div class="fico-readout"><strong>${score}</strong><span>${esc(band)}</span></div>
  </div>`;
}

function armMeters() {
  requestAnimationFrame(() => {
    document.querySelectorAll(".fico-needle").forEach((el) => el.classList.add("moved"));
  });
}

function sparkline(values) {
  const w = 720;
  const h = 88;
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 8) - 4).toFixed(1)}`).join(" ");
  return `<svg class="rho-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline fill="none" stroke="#1f9d88" stroke-width="2.2" points="${pts}" />
  </svg>`;
}

function dailyOutflows() {
  const days = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const buckets = Object.fromEntries(days.map((d) => [d, 0]));
  for (const tx of score.transactions || []) {
    if (tx.direction !== "out") continue;
    const key = String(tx.at || "").slice(0, 10);
    if (key in buckets) buckets[key] += tx.amountCents;
  }
  for (const tx of score.rhoTransactions || []) {
    if (tx.amountCents >= 0) continue;
    const key = String(tx.at || "").slice(0, 10);
    if (key in buckets) buckets[key] += Math.abs(tx.amountCents);
  }
  return days.map((d) => buckets[d]);
}

function badge(kind, label) {
  return `<span class="rho-badge ${kind}">${esc(label)}</span>`;
}

function metric(label, value, hint) {
  return `<article class="rho-metric">
    <div class="rho-metric-label">${esc(label)}</div>
    <div class="rho-metric-value">${esc(value)}</div>
    ${hint ? `<div class="rho-metric-hint">${esc(hint)}</div>` : ""}
  </article>`;
}

function unifiedRows() {
  const rows = [];
  for (const tx of score.transactions || []) {
    const outbound = tx.direction === "out";
    rows.push({
      at: tx.at,
      amountCents: outbound ? -tx.amountCents : tx.amountCents,
      sender: outbound ? (tx.role === "buyer" ? "Buyer wallet" : "Seller wallet") : tx.title || "Counterparty",
      recipient: outbound ? tx.title || "Counterparty" : tx.role === "seller" ? "Seller wallet" : "Buyer wallet",
      type: tx.rail === "crypto" ? "USDC · ARC" : "STRIPE",
      rail: tx.rail,
      source: "ledger",
      user: AGENT[tx.agentId] || tx.agentId,
      href: tx.explorerUrl,
      ref: tx.circleTxHash || tx.stripePaymentIntentId || tx.reference,
    });
  }
  for (const tx of score.rhoTransactions || []) {
    rows.push({
      at: tx.at,
      amountCents: tx.amountCents,
      sender: tx.amountCents < 0 ? tx.account : tx.counterparty || tx.account,
      recipient: tx.amountCents < 0 ? tx.counterparty : tx.account,
      type: String(tx.type || "RHO").toUpperCase().replace(/_/g, "-"),
      rail: "rho",
      source: tx.source,
      user: AGENT[agentFromMemo(tx.memo)] || "Rho",
      href: null,
      ref: tx.id,
    });
  }
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

function renderHome() {
  const s = score.summary || {};
  const wallets = score.wallets || {};
  const values = dailyOutflows();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  const end = new Date();
  const axis = [start, end].map((d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  const shopping = (score.credit || []).find((a) => a.agentId === "sales");
  const merchant = score.merchant;
  document.getElementById("pane-home").innerHTML = `
    <p class="rho-kicker">Home</p>
    <h1 class="rho-headline">${esc(score.headline || "Commerce claimed it. You don't underwrite from a storefront anymore.")}</h1>
    <div class="fico-row">
      ${shopping ? ficoMeter(shopping.fico, "Shopping Agent") : ""}
      ${merchant ? ficoMeter(merchant.fico, "Merchant Agent") : ""}
    </div>
    <div class="rho-toolbar">
      <h2 class="rho-h2">Balance</h2>
      <div class="rho-muted">All rails · last 30 days</div>
    </div>
    <div class="rho-balance-card">
      <div class="rho-balance-meta">
        <span>All accounts</span>
        <span class="rho-pending">↔ ${usd(s.creditLineUsd || 0)} suggested credit line</span>
      </div>
      <div class="rho-balance">${usd((wallets.buyerUsdc || 0) + (wallets.sellerUsdc || 0))}</div>
      <div class="rho-balance-sub">
        <span>Prepaid float ${usd(wallets.buyerUsdc || 0)} USDC</span>
        <span>Merchant ${usd(wallets.sellerUsdc || 0)} USDC</span>
        <span>Unmatched claims ${money(s.unmatchedCents || 0)}</span>
      </div>
      ${sparkline(values)}
      <div class="rho-spark-axis"><span>${axis[0]}</span><span>${axis[1]}</span></div>
    </div>
    <div class="rho-split">
      <div>
        <h2 class="rho-h2">Rho accounts</h2>
        <div class="rho-account" role="button" tabindex="0" data-go="banking-crypto">
          <div><div class="rho-account-name">Crypto · Arc Testnet</div><div class="rho-account-id">${esc((wallets.buyerAddress || "").slice(0, 10))}…</div></div>
          <strong>${usd(wallets.buyerUsdc || 0)}</strong>
        </div>
        <div class="rho-account" role="button" tabindex="0" data-go="banking-fiat">
          <div><div class="rho-account-name">Fiat · Stripe</div><div class="rho-account-id">Visa ···4242</div></div>
          <strong>${s.fiatCount || 0} charges</strong>
        </div>
        <div class="rho-account" role="button" tabindex="0" data-go="banking-rho">
          <div><div class="rho-account-name">Rho operating</div><div class="rho-account-id">${score.mode === "live" ? "live feed" : "Rho settlements"}</div></div>
          <strong>${s.rhoCount || 0} settlements</strong>
        </div>
      </div>
      <div>
        <h2 class="rho-h2">Money movement</h2>
        <div class="rho-metric-row stacked">
          ${metric("Total outflows", money(s.outflowCents || 0), "Agent spend this ledger")}
          ${metric("Settled in", money(s.inflowCents || 0), "Merchant + Rho credits")}
          ${metric("Approvals needed", String(s.unmatched || 0), "Commerce claims without a Rho match")}
        </div>
      </div>
    </div>
  `;
  armMeters();
}

function renderBanking() {
  const want = bankFilter;
  let rows = unifiedRows();
  if (want === "crypto") rows = rows.filter((r) => r.rail === "crypto");
  if (want === "fiat") rows = rows.filter((r) => r.rail === "fiat");
  if (want === "rho") rows = rows.filter((r) => r.rail === "rho");
  if (bankQuery) {
    const q = bankQuery.toLowerCase();
    rows = rows.filter((r) =>
      [r.sender, r.recipient, r.type, r.user, r.ref].join(" ").toLowerCase().includes(q),
    );
  }
  const title =
    want === "crypto" ? "Crypto · USDC" : want === "fiat" ? "Fiat · Stripe" : want === "rho" ? "Rho settlements" : "All activity";
  document.getElementById("pane-banking").innerHTML = `
    <div class="rho-tabs">
      <button type="button" class="rho-tab ${want === "all" ? "active" : ""}" data-bank="all">Rho accounts</button>
      <button type="button" class="rho-tab ${want === "crypto" ? "active" : ""}" data-bank="crypto">Crypto</button>
      <button type="button" class="rho-tab ${want === "fiat" ? "active" : ""}" data-bank="fiat">Fiat</button>
      <button type="button" class="rho-tab ${want === "rho" ? "active" : ""}" data-bank="rho">Rho settlements</button>
    </div>
    <div class="rho-stat-row">
      ${metric("Balance", usd((score.wallets?.buyerUsdc || 0) + (score.wallets?.sellerUsdc || 0)), "Prepaid wallets")}
      ${metric("Pending unmatched", money(score.summary?.unmatchedCents || 0), "Commerce claims still open")}
      ${metric("Approvals needed", String(score.summary?.unmatched || 0), "Orders without Rho")}
    </div>
    <div class="rho-toolbar">
      <h2 class="rho-h2">${esc(title)}</h2>
      <input class="rho-search" id="bankSearch" placeholder="Search all transactions…" value="${esc(bankQuery)}" />
    </div>
    <table class="rho-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Amount</th>
          <th>Sender</th>
          <th>Recipient</th>
          <th>Type</th>
          <th>User</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows
            .slice(0, 80)
            .map((r) => {
              const cls = r.amountCents < 0 ? "neg" : "pos";
              const amt = money(Math.abs(r.amountCents));
              const cell = r.href
                ? `<a href="${esc(r.href)}" target="_blank" rel="noreferrer">${r.amountCents < 0 ? "−" : ""}${amt}</a>`
                : `${r.amountCents < 0 ? "−" : ""}${amt}`;
              return `<tr>
                <td>${when(r.at)}</td>
                <td class="${cls}">${cell}</td>
                <td>${esc(r.sender)}</td>
                <td>${esc(r.recipient)}</td>
                <td>${esc(r.type)}</td>
                <td>${esc(r.user)}</td>
              </tr>`;
            })
            .join("") || `<tr><td colspan="6">No movements on this rail yet.</td></tr>`
        }
      </tbody>
    </table>
  `;
  const search = document.getElementById("bankSearch");
  if (search) {
    search.addEventListener("input", (e) => {
      bankQuery = e.target.value;
      renderBanking();
      document.getElementById("bankSearch")?.focus();
      const el = document.getElementById("bankSearch");
      if (el) el.selectionStart = el.selectionEnd = bankQuery.length;
    });
  }
}

function renderAgents() {
  const list = (score.credit || []).filter((a) => agentFilter === "all" || a.agentId === agentFilter);
  const pnl = score.agents || [];
  document.getElementById("pane-agents").innerHTML = `
    <div class="rho-tabs">
      <button type="button" class="rho-tab ${agentFilter === "all" ? "active" : ""}" data-agent="all">All agents</button>
      <button type="button" class="rho-tab ${agentFilter === "sales" ? "active" : ""}" data-agent="sales">Shopping</button>
      <button type="button" class="rho-tab ${agentFilter === "support" ? "active" : ""}" data-agent="support">Support</button>
      <button type="button" class="rho-tab ${agentFilter === "research" ? "active" : ""}" data-agent="research">Research</button>
    </div>
    <div class="rho-stat-row">
      ${metric("Active agents", String((score.credit || []).length), "4C files")}
      ${metric("Suggested line", usd(score.winner?.creditLineUsd || 0), score.winner?.name || "—")}
      ${metric("Prepaid today", "Yes", "Credit is the file, not the rail")}
    </div>
    <div class="rho-card-list">
      ${list
        .map((a) => {
          const card = pnl.find((p) => p.agentId === a.agentId);
          return `<article class="rho-file">
            <div class="rho-file-top">
              <div>
                <div class="rho-account-id">line ${usd(a.creditLineUsd)} · prepaid</div>
                <h3>${esc(a.name)}</h3>
              </div>
              ${ficoMeter(a.fico, "")}
            </div>
            <div class="rho-cs">
              ${(a.blocks || [])
                .map(
                  (b) => `<div class="rho-c">
                    <span>${esc(b.name)}</span>
                    <strong>${esc(b.score)}</strong>
                    <p>${esc(b.detail || "")}</p>
                  </div>`,
                )
                .join("")}
            </div>
            <p class="rho-thesis">${esc(a.thesis || "")}</p>
            ${
              card
                ? `<div class="rho-file-pnl">Revenue ${money(card.revenueCents)} · Cost ${money(card.costCents)} · ROI ${card.roi}x · ${esc(card.question)}</div>`
                : ""
            }
          </article>`;
        })
        .join("")}
    </div>
  `;
  armMeters();
}

function identCard(role, t, fico) {
  if (!t) return "";
  const title = role === "buyer" ? "Shopping Agent" : "Merchant Agent";
  return `<article class="rho-file">
    <div class="rho-account-id">ERC-8004 #${esc(t.agentId)}</div>
    <h3>${esc(t.name || title)}</h3>
    ${ficoMeter(fico, "")}
    <div class="rho-cs">
      <div class="rho-c"><span>Feedback</span><strong>${esc(t.reputationSignals ?? "—")}</strong></div>
      <div class="rho-c"><span>Validations</span><strong>${esc(t.validationSignals ?? "—")}</strong></div>
      <div class="rho-c"><span>x402</span><strong>${t.x402Supported ? "yes" : "no"}</strong></div>
      <div class="rho-c"><span>Publisher</span><strong>${t.publisherVerified ? "verified" : "unverified"}</strong></div>
    </div>
    <p class="rho-thesis">${esc(t.characterDetail || "")}</p>
    ${t.scanUrl ? `<a class="rho-link" href="${esc(t.scanUrl)}" target="_blank" rel="noreferrer">Open 8004scan</a>` : ""}
  </article>`;
}

function renderIdentity() {
  const ids = score.identities || {};
  const showBuyer = identFilter !== "seller";
  const showSeller = identFilter !== "buyer";
  document.getElementById("pane-identity").innerHTML = `
    <div class="rho-tabs">
      <button type="button" class="rho-tab ${identFilter === "all" ? "active" : ""}" data-ident="all">Both agents</button>
      <button type="button" class="rho-tab ${identFilter === "buyer" ? "active" : ""}" data-ident="buyer">Shopping Agent</button>
      <button type="button" class="rho-tab ${identFilter === "seller" ? "active" : ""}" data-ident="seller">Merchant Agent</button>
    </div>
    <p class="rho-lede">Character is live ERC-8004 feedback and validations — not a single trust score.</p>
    <div class="rho-ident-grid">
      ${showBuyer ? identCard("buyer", ids.buyer, (score.credit || []).find((a) => a.agentId === "sales")?.fico) : ""}
      ${showSeller ? identCard("seller", ids.seller, score.merchant?.fico) : ""}
    </div>
  `;
  armMeters();
}

function renderRecon() {
  const s = score.summary || {};
  const rows = score.matches || [];
  document.getElementById("pane-recon").innerHTML = `
    <h1 class="rho-h1">Reconciliation</h1>
    <p class="rho-lede">Storefront claims on the left. Rho settlement on the right. Unmatched rows are the credit file's "overdue."</p>
    <div class="rho-stat-row">
      ${metric("Paid · matched", money(s.matchedCents || 0), `${s.matched || 0} joins`)}
      ${metric("Overdue · unmatched", money(s.unmatchedCents || 0), `${s.unmatched || 0} claims`)}
      ${metric("Rho settlements", String(s.rhoCount || 0), score.mode === "live" ? "live" : "joined to the ledger")}
      ${metric("Unpaid", "$0.00", "Prepaid rails — no AR float")}
    </div>
    <table class="rho-table">
      <thead>
        <tr>
          <th>Due</th>
          <th>Status</th>
          <th>Agent</th>
          <th>Customer / order</th>
          <th>Amount</th>
          <th>Rho id</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows
            .map((row) => {
              const paid = Boolean(row.rhoId);
              return `<tr>
                <td>${when(row.createdAt || row.postedAt)}</td>
                <td>${paid ? badge("ok", "Paid") : badge("warn", "Overdue")}</td>
                <td>${esc(AGENT[row.agentId] || row.agentId)}</td>
                <td>${esc(row.title)}</td>
                <td>${money(row.amountCents)}</td>
                <td>${esc(row.rhoId || "—")}</td>
              </tr>`;
            })
            .join("") || `<tr><td colspan="6">No commerce claims yet.</td></tr>`
        }
      </tbody>
    </table>
  `;
}

const PANES = {
  home: () => {
    bankFilter = "all";
    renderHome();
    return "home";
  },
  banking: () => {
    bankFilter = "all";
    renderBanking();
    return "banking";
  },
  "banking-crypto": () => {
    bankFilter = "crypto";
    renderBanking();
    return "banking";
  },
  "banking-fiat": () => {
    bankFilter = "fiat";
    renderBanking();
    return "banking";
  },
  "banking-rho": () => {
    bankFilter = "rho";
    renderBanking();
    return "banking";
  },
  agents: () => {
    agentFilter = "all";
    renderAgents();
    return "agents";
  },
  "agent-sales": () => {
    agentFilter = "sales";
    renderAgents();
    return "agents";
  },
  "agent-support": () => {
    agentFilter = "support";
    renderAgents();
    return "agents";
  },
  "agent-research": () => {
    agentFilter = "research";
    renderAgents();
    return "agents";
  },
  identity: () => {
    identFilter = "all";
    renderIdentity();
    return "identity";
  },
  "identity-buyer": () => {
    identFilter = "buyer";
    renderIdentity();
    return "identity";
  },
  "identity-seller": () => {
    identFilter = "seller";
    renderIdentity();
    return "identity";
  },
  recon: () => {
    renderRecon();
    return "recon";
  },
};

function go(key) {
  const run = PANES[key] || PANES.home;
  const pane = run();
  document.querySelectorAll(".rho-pane").forEach((el) => {
    el.hidden = el.id !== `pane-${pane}`;
  });
  document.querySelectorAll(".rho-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.go === key);
  });
  history.replaceState(null, "", `#${key}`);
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-go]");
  if (nav) {
    go(nav.dataset.go);
    return;
  }
  const bank = e.target.closest("[data-bank]");
  if (bank) {
    bankFilter = bank.dataset.bank;
    renderBanking();
    return;
  }
  const agent = e.target.closest("[data-agent]");
  if (agent) {
    agentFilter = agent.dataset.agent;
    renderAgents();
    return;
  }
  const ident = e.target.closest("[data-ident]");
  if (ident) {
    identFilter = ident.dataset.ident;
    renderIdentity();
  }
});

async function load() {
  const [body, health] = await Promise.all([
    fetch("/api/ledger/scorecard").then((r) => r.json()),
    fetch("/api/health").then((r) => r.json()),
  ]);
  score = body;
  document.getElementById("modePill").textContent = health.paymentMode || "adapter";
  document.getElementById("rhoPill").textContent = score.mode === "live" ? "rho · live" : "rho · fixture";
  const hash = (location.hash || "#home").slice(1);
  go(PANES[hash] ? hash : "home");
}

load().catch(() => {
  document.getElementById("modePill").textContent = "offline";
});

function pushChat(role, text) {
  chatHistory.push({ role, content: text });
  const log = document.getElementById("chatLog");
  const row = document.createElement("div");
  row.className = `rho-chat-msg ${role}`;
  row.textContent = text;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

document.getElementById("chatForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chatInput");
  const question = String(input.value || "").trim();
  if (!question || !score) return;
  input.value = "";
  pushChat("user", question);
  const pending = document.createElement("div");
  pending.className = "rho-chat-msg assistant pending";
  pending.textContent = "Reading the ledger…";
  document.getElementById("chatLog").appendChild(pending);
  try {
    const res = await fetch("/api/ledger/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        history: chatHistory.slice(0, -1).slice(-6),
      }),
    });
    const data = await res.json();
    pending.remove();
    pushChat("assistant", data.answer || "I couldn't read that against the scoreboard.");
  } catch (err) {
    pending.remove();
    pushChat("assistant", err.message || "Chat is offline.");
  }
});
