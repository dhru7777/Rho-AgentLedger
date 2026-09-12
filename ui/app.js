const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const phaseMap = {
  intent: "intent",
  discover: "discover",
  trust: "trust",
  policy: "policy",
  pay: "pay",
  service: "verify",
  verify: "verify",
  settle: "settle",
  receipt: "receipt",
  ledger: "ledger",
};

const CIRCLE_CATEGORIES = [
  { id: "CREATIVE", label: "Creative" },
  { id: "DATA_ENRICHMENT", label: "Data Enrichment" },
  { id: "FINANCIAL_ANALYSIS", label: "Financial Analysis" },
  { id: "INFRASTRUCTURE", label: "Infrastructure" },
  { id: "PREDICTION_MARKETS", label: "Prediction Markets" },
  { id: "SOCIAL_INTELLIGENCE", label: "Social Intelligence" },
  { id: "WEB_SEARCH_RESEARCH", label: "Web Search Research" },
];

let identities = null;
let playing = false;
let clarifying = false;
let sessionId = null;
let sellerTab = "shopify";
let activeCategory = "";
let lastCatalog = { digital: [], shopify: [], digitalMeta: null };
let lastPrompt = "";
let pending = null;
let receipts = [];

function resetPhases() {
  document.querySelectorAll(".phase-step").forEach((el) => el.classList.remove("lit", "fail"));
}
function lightPhase(id, failed) {
  const el = document.querySelector(`.phase-step[data-phase="${id}"]`);
  if (!el) return;
  el.classList.add(failed ? "fail" : "lit");
}
function setRail(policy, payment) {
  const badge = $("railBadge");
  badge.className = "rail-badge";
  if (!policy) {
    badge.textContent = "rail · idle";
    return;
  }
  if (policy.decision === "REJECT") {
    badge.textContent = "rejected";
    badge.classList.add("reject");
    return;
  }
  if (payment?.scheme === "stripe") {
    badge.textContent = "fiat · stripe";
    badge.classList.add("direct");
    return;
  }
  if (policy.rail === "DIRECT") {
    badge.textContent = "nano · instant";
    badge.classList.add("direct");
    return;
  }
  badge.textContent = "escrow · protected";
  badge.classList.add("protected");
}

function addBubble(feed, kind, text, label) {
  const wrap = document.createElement("div");
  wrap.className = `bwrap ${kind === "out" ? "sent" : kind === "sys" ? "mid" : "recv"}`;
  if (label) {
    const l = document.createElement("div");
    l.className = "blabel";
    l.textContent = label;
    wrap.appendChild(l);
  }
  const b = document.createElement("div");
  b.className = `bubble ${kind}`;
  b.textContent = text;
  wrap.appendChild(b);
  feed.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  feed.scrollTop = feed.scrollHeight;
  return wrap;
}

function addHtml(feed, html, kind = "inc", label = "ARC Agent") {
  const wrap = document.createElement("div");
  wrap.className = `bwrap ${kind === "out" ? "sent" : kind === "sys" ? "mid" : "recv"}`;
  if (label) {
    const l = document.createElement("div");
    l.className = "blabel";
    l.textContent = label;
    wrap.appendChild(l);
  }
  const b = document.createElement("div");
  b.className = `bubble ${kind === "sys" ? "sys" : kind}`;
  b.innerHTML = html;
  wrap.appendChild(b);
  feed.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  feed.scrollTop = feed.scrollHeight;
  return wrap;
}

function addCollapseCard(feed, title, summary, rows, extras) {
  const wrap = document.createElement("div");
  wrap.className = "bwrap recv";
  const details = document.createElement("details");
  details.className = "kv-details";
  const list = extras?.list?.filter(Boolean) || [];
  details.innerHTML =
    `<summary><span>${esc(title)}</span><strong>${esc(summary)}</strong></summary>` +
    `<div class="kv-details-body">` +
    Object.entries(rows)
      .map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`)
      .join("") +
    (list.length
      ? `<div class="kv-list"><div class="kv-list-label">${esc(extras.listLabel || "Why")}</div><ul>${list
          .map((item) => `<li>${esc(item)}</li>`)
          .join("")}</ul></div>`
      : "") +
    `</div>`;
  wrap.appendChild(details);
  feed.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  feed.scrollTop = feed.scrollHeight;
}

function addQuoteHero(feed, body) {
  const wrap = document.createElement("div");
  wrap.className = "bwrap recv";
  const label = document.createElement("div");
  label.className = "blabel";
  label.textContent = "ARC Agent";
  wrap.appendChild(label);
  const hero = document.createElement("div");
  hero.className = "quote-hero";
  const change = body.change24h == null ? "" : `24h ${Number(body.change24h) >= 0 ? "+" : ""}${Number(body.change24h).toFixed(2)}%`;
  hero.innerHTML =
    `<div class="quote-kicker">Live from the Arc x402 seller</div>` +
    `<div class="quote-price">${esc(body.asset || "ETH")} ${Number(body.price).toFixed(2)} USD</div>` +
    (change ? `<div class="quote-chg">${esc(change)}</div>` : "") +
    (body.summary ? `<div class="quote-note">${esc(String(body.summary))}</div>` : "");
  wrap.appendChild(hero);
  feed.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  feed.scrollTop = feed.scrollHeight;
}

function scanLink(url) {
  if (!url) return "";
  return `<a class="scan-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Verify Identity of Agent ↗</a>`;
}

function kvVal(v) {
  if (v && typeof v === "object" && v.href) {
    return `<a class="scan-inline" href="${esc(v.href)}" target="_blank" rel="noopener noreferrer">${esc(v.label)}</a>`;
  }
  return esc(String(v ?? ""));
}

function kvHtml(title, rows) {
  return `<div class="pop-title">${title}</div>` +
    Object.entries(rows)
      .map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><strong>${kvVal(v)}</strong></div>`)
      .join("");
}

function walletSectionHtml(title, rows) {
  return `<div class="pop-section">${esc(title)}</div>` +
    Object.entries(rows)
      .map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`)
      .join("");
}

function cryptoWalletHtml(data, role) {
  if (!data) {
    return `<div class="pop-title">${role === "buyer" ? "BUYER · CRYPTO" : "SELLER · CRYPTO"}</div><div class="tx-empty">Loading ArcScan…</div>`;
  }
  const usdc = data.usdc == null ? "—" : `${Number(data.usdc).toFixed(2)} USDC`;
  const transfers = data.recentTransfers || [];
  const rows = transfers.length
    ? transfers.slice(0, 8).map((tx) => {
        const outbound = tx.direction === "out";
        const sign = outbound ? "−" : "+";
        const cls = outbound ? "tx-out" : "tx-in";
        const when = tx.at ? new Date(tx.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
        return `<div class="tx-row">
          <div class="${cls}">${sign}$${(tx.amountCents / 100).toFixed(2)} USDC</div>
          <div class="tx-meta"><span>${esc(tx.title || "")}</span><span>${esc(when)}</span></div>
          <div class="tx-meta"><span>${esc(tx.status || "success")}</span><a href="${esc(tx.explorerUrl)}" target="_blank" rel="noreferrer">${esc(shortHash(tx.hash))}</a></div>
        </div>`;
      }).join("")
    : `<div class="tx-empty">${data.errors?.length ? esc(data.errors[0]) : "No USDC transfers on ArcScan yet"}</div>`;
  return (
    `<div class="pop-title">${role === "buyer" ? "BUYER · CRYPTO" : "SELLER · CRYPTO"}</div>` +
    walletSectionHtml("Balance", {
      USDC: usdc,
      Source: data.source || "—",
      Explorer: "ArcScan",
    }) +
    walletSectionHtml("Wallet", {
      Chain: data.chain || "Arc Testnet",
      Address: data.address || "unassigned",
    }) +
    `<div class="pop-section">${transfers.length ? "Recent USDC · ArcScan" : "Recent USDC"}</div>` +
    rows
  );
}

function fiatWalletHtml(data, role) {
  if (!data || !data.configured) {
    return `<div class="pop-title">STRIPE · ${role}</div><div class="tx-empty">Set STRIPE_SECRET_KEY to open the fiat wallet.</div>`;
  }
  if (role === "buyer") {
    const charges = data.recentCharges || [];
    return (
      `<div class="pop-title">STRIPE · BUYER</div>` +
      walletSectionHtml("Card", { Brand: (data.card?.brand || "visa").toUpperCase(), Last4: `···${data.card?.last4 || "4242"}`, Mode: "test" }) +
      `<div class="pop-section">${charges.length ? "Recent charges" : "No charges yet"}</div>` +
      charges.slice(0, 5).map((ch) => {
        const href = ch.paymentIntentId ? `https://dashboard.stripe.com/test/payments/${ch.paymentIntentId}` : "#";
        return `<div class="tx-row"><div class="tx-out">−$${(ch.amountCents / 100).toFixed(2)} USD</div><div class="tx-meta"><span>${esc(ch.status)}</span><a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(shortHash(ch.paymentIntentId))}</a></div></div>`;
      }).join("")
    );
  }
  const charges = data.recentCharges || [];
  return (
    `<div class="pop-title">STRIPE · SELLER</div>` +
    walletSectionHtml("Account", {
      Connect: data.connectEnabled ? "on" : "off",
      Mode: "test",
    }) +
    `<div class="pop-section">${charges.length ? "Received" : "No fiat receipts yet"}</div>` +
    charges.slice(0, 5).map((ch) => {
      const href = ch.paymentIntentId ? `https://dashboard.stripe.com/test/payments/${ch.paymentIntentId}` : "#";
      return `<div class="tx-row"><div class="tx-in">+$${(ch.amountCents / 100).toFixed(2)} USD</div><div class="tx-meta"><span>${esc(ch.status)}</span><a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(shortHash(ch.paymentIntentId))}</a></div></div>`;
    }).join("")
  );
}

function renderWalletPop(role) {
  const el = role === "buyer" ? $("buyerWalletPop") : $("sellerWalletPop");
  const cryptoId = `wtab-crypto-${role}`;
  const fiatId = `wtab-fiat-${role}`;
  el.innerHTML = `
    <div class="wallet-tab-bar">
      <button type="button" class="wallet-tab-btn active" data-tab="crypto">Crypto</button>
      <button type="button" class="wallet-tab-btn" data-tab="fiat">Fiat</button>
    </div>
    <div id="${cryptoId}"><div class="tx-empty">Loading ArcScan…</div></div>
    <div id="${fiatId}" hidden><div class="tx-empty">Loading Stripe…</div></div>`;
  fetch(`/api/wallet/${role}/crypto`)
    .then((r) => r.json())
    .then((data) => { $(cryptoId).innerHTML = cryptoWalletHtml(data, role); })
    .catch((err) => { $(cryptoId).innerHTML = `<div class="tx-empty">${esc(err.message || err)}</div>`; });
  el.querySelectorAll(".wallet-tab-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const tab = btn.dataset.tab;
      el.querySelectorAll(".wallet-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      $(cryptoId).hidden = tab !== "crypto";
      $(fiatId).hidden = tab !== "fiat";
      if (tab === "fiat") {
        try {
          const data = await fetch(`/api/wallet/${role}/fiat`).then((r) => r.json());
          $(fiatId).innerHTML = fiatWalletHtml(data, role);
        } catch (err) {
          $(fiatId).innerHTML = `<div class="tx-empty">${esc(err.message || err)}</div>`;
        }
      }
      if (tab === "crypto") {
        try {
          const data = await fetch(`/api/wallet/${role}/crypto`).then((r) => r.json());
          $(cryptoId).innerHTML = cryptoWalletHtml(data, role);
        } catch (err) {
          $(cryptoId).innerHTML = `<div class="tx-empty">${esc(err.message || err)}</div>`;
        }
      }
    });
  });
}

function shortAddr(addr) {
  if (!addr) return "unassigned";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortHash(hash) {
  if (!hash || hash === "pending") return "pending";
  return `${hash.slice(0, 8)}…`;
}

function fmtUsd(n) {
  if (n == null) return "—";
  if (n === 0) return "$0";
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

function productThumb(url) {
  return url
    ? `<img class="p-ph" src="${esc(url)}" alt="" onerror="this.style.visibility='hidden'" />`
    : `<div class="p-ph"></div>`;
}

function txListHtml(role, rail) {
  const rows = (lastScorecard?.transactions || receipts)
    .filter((tx) => {
      if (tx.role && tx.role !== role) return false;
      if (rail && tx.rail && tx.rail !== rail) return false;
      return true;
    })
    .slice(0, 5);
  if (!rows.length) return `<div class="tx-empty">No transactions yet</div>`;
  return rows
    .map((tx) => {
      const outbound = tx.direction ? tx.direction === "out" : role === "buyer";
      const cls = outbound ? "tx-out" : "tx-in";
      const sign = outbound ? "−" : "+";
      const amount = tx.amountCents != null ? (tx.amountCents / 100).toFixed(2) : tx.amount;
      const href = esc(tx.explorerUrl || "#");
      const when = tx.at || tx.createdAt ? new Date(tx.at || tx.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      const railLabel = tx.rail === "fiat" ? "USD" : tx.currency || "USDC";
      return `<div class="tx-row">
        <div class="${cls}">${sign}$${esc(amount)} · ${esc(railLabel)}</div>
        <div class="tx-meta"><span>${esc(tx.title || tx.service || "")}</span><span>${esc(when)}</span></div>
        <div class="tx-meta"><span>${esc(tx.status || tx.outcome || "")}</span><a href="${href}" target="_blank" rel="noreferrer">${esc(shortHash(tx.stripePaymentIntentId || tx.circleTxHash || tx.paymentTxHash))}</a></div>
      </div>`;
    })
    .join("");
}

async function refreshReceipts() {
  try {
    receipts = await fetch("/api/receipts").then((r) => r.json());
  } catch {
    receipts = [];
  }
}

function moneyCents(cents) {
  return `$${(Number(cents || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

let lastScorecard = null;

async function refreshLedger() {
  try {
    lastScorecard = await fetch("/api/ledger/scorecard").then((r) => r.json());
  } catch {
    lastScorecard = null;
  }
  const pill = $("rhoPill");
  if (pill && lastScorecard) {
    pill.textContent = lastScorecard.mode === "live" ? "rho · live" : "rho · fixture";
  }
  if (lastScorecard?.matches?.length) lightPhase("ledger");
  if (sellerTab === "ledger") renderLedgerTab();
}

function renderLedgerTab() {
  const feed = $("feedSeller");
  if (!lastScorecard) {
    feed.innerHTML = `<div class="empty-hint">Loading AgentLedger…</div>`;
    return;
  }
  const credit = lastScorecard.credit || [];
  feed.innerHTML = `
    ${credit
      .map(
        (a) => `<div class="ledger-row">
          <div class="p-vendor">${esc(a.name)} · ${esc(a.ficoBand || "")} ${esc(a.fico || a.score)}</div>
          <div class="p-title">${(a.blocks || []).map((b) => `${b.name} ${b.score}`).join(" · ")}</div>
        </div>`,
      )
      .join("")}
    <div class="empty-hint">Open the scoreboard for credit gauges and chat.</div>
  `;
}

function fillCategories() {
  const row = $("categoryRow");
  row.innerHTML = CIRCLE_CATEGORIES.map(
    (c) => `<button type="button" class="cat-chip" data-cat="${c.id}">${esc(c.label)}</button>`,
  ).join("");
  row.querySelectorAll(".cat-chip").forEach((btn) => {
    btn.addEventListener("click", () => browseCategory(btn.dataset.cat));
  });
}

function setSellerTab(tab, opts = {}) {
  sellerTab = tab;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  $("categoryRow").hidden = true;
  if (tab === "ledger") {
    $("sellerName").textContent = "AgentLedger";
    $("sellerSub").textContent = lastScorecard?.mode === "live" ? "Rho live settlements" : "Rho fixture feed";
    if (!opts.skipRender) renderLedgerTab();
    return;
  }
  $("sellerName").textContent = tab === "shopify" ? "Shopify Agent" : "Arc x402 seller";
  if (!opts.skipRender) return renderSellerCatalog(opts);
}

function highlightRow(row) {
  $("feedSeller").querySelectorAll(".product-row").forEach((el) => el.classList.remove("glow"));
  if (row) row.classList.add("glow");
}

async function renderSellerCatalog(opts = {}) {
  const feed = $("feedSeller");
  const items = sellerTab === "shopify" ? lastCatalog.shopify : lastCatalog.digital;
  if (sellerTab === "ledger") return renderLedgerTab();
  if (!items?.length) {
    feed.innerHTML = `<div class="empty-hint">${sellerTab === "shopify" ? "Waiting on ARC Agent" : "Pick a category or ask ARC Agent"}</div>`;
    return;
  }
  feed.innerHTML = "";
  const status = document.createElement("div");
  status.className = "merchant-status";
  if (sellerTab === "shopify") status.textContent = `UCP · ${items.length} matching offers`;
  else {
    const meta = lastCatalog.digitalMeta || {};
    status.textContent = `${(meta.category || "Arc x402").replace(/_/g, " ")} · ${items.length} of ${meta.total ?? "?"}`;
  }
  feed.appendChild(status);
  const rows = items.slice(0, 5);
  for (let i = 0; i < rows.length; i++) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "product-row";
    if (sellerTab === "shopify") {
      const offer = rows[i];
      row.innerHTML = `
        ${productThumb(offer.imageUrl)}
        <div>
          <div class="p-vendor">${esc(offer.merchantName)}</div>
          <div class="p-title">${esc(offer.title)}</div>
          <div class="p-price">$${(offer.priceCents / 100).toFixed(2)}</div>
        </div>
        <div class="p-bid"><div class="p-rail">Shopify UCP</div><span class="bid-amt">escrow on Arc</span></div>`;
      row.addEventListener("click", () => selectOffer("shopify", offer, row));
    } else {
      const listing = rows[i];
      const net = (listing.advertisedNetwork || listing.networks?.[0] || "unknown").replace("eip155:", "chain ");
      const rail = listing.priceUsd == null || listing.priceUsd === 0 ? "listed" : listing.priceUsd >= 100 ? "escrow" : "nano";
      row.innerHTML = `
        ${productThumb()}
        <div>
          <div class="p-vendor">${esc(listing.name)} · ${esc(listing.category)}</div>
          <div class="p-title">${esc(listing.description || listing.resource)}</div>
          <div class="p-price">${fmtUsd(listing.priceUsd)}</div>
        </div>
        <div class="p-bid"><div class="p-rail">${rail}</div><span class="bid-amt">${esc(net)}</span></div>`;
      row.addEventListener("click", () => selectOffer("digital", listing, row));
    }
    feed.appendChild(row);
    if (opts.stagger) await sleep(70);
    row.classList.add("show");
    if (i === 0) row.classList.add("glow");
  }
}

function lockChoices(selected) {
  $("feedBuyer").querySelectorAll(".choice-chip:not(:disabled)").forEach((btn) => {
    btn.disabled = true;
    const q = String(btn.dataset.q || "").trim().toLowerCase();
    btn.classList.toggle("is-selected", Boolean(selected) && q === String(selected).trim().toLowerCase());
  });
}

function addAgentAsk(message, options) {
  const chips = (options || [])
    .map((opt) => `<button type="button" class="choice-chip" data-q="${esc(opt)}">${esc(opt)}</button>`)
    .join("");
  const wrap = addHtml(
    $("feedBuyer"),
    `${esc(message)}${chips ? `<div class="choice-row">${chips}</div>` : ""}`,
  );
  wrap.querySelectorAll(".choice-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (playing) return;
      onSubmit(btn.dataset.q);
    });
  });
}

function offerTitle(kind, item) {
  if (kind === "shopify") return item.title;
  return item.description || item.name;
}

function offerPrice(kind, item) {
  if (kind === "shopify") return item.priceCents / 100;
  return item.priceUsd;
}

function renderChatOffers(kind, items) {
  const ranked = [...items].sort((a, b) => (offerPrice(kind, a) ?? 999) - (offerPrice(kind, b) ?? 999));
  const pick = ranked[0] || items[0];
  const cards = ranked
    .slice(0, 5)
    .map((item) => {
      const title = offerTitle(kind, item);
      const price = offerPrice(kind, item);
      const thumb = kind === "shopify" ? productThumb(item.imageUrl) : productThumb();
      const vendor = kind === "shopify" ? item.merchantName : item.name;
      const selected = item === pick || (kind === "shopify" ? item.productId === pick.productId : item.resource === pick.resource);
      const idx = items.indexOf(item);
      return `<button type="button" class="chat-offer${selected ? " pick" : ""}" data-i="${idx}">${thumb}<div><div class="p-vendor">${esc(vendor)}</div><div class="p-title">${esc(title)}</div></div><div class="p-price">${kind === "shopify" ? `$${Number(price).toFixed(2)}` : fmtUsd(price)}</div></button>`;
    })
    .join("");
  const wrap = addHtml(
    $("feedBuyer"),
    `I found ${ranked.length}. I recommend <b>${esc(offerTitle(kind, pick))}</b> — tap to choose, then approve.<div class="chat-offers">${cards}</div>`,
  );
  wrap.querySelectorAll(".chat-offer").forEach((btn) => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".chat-offer").forEach((el) => el.classList.remove("pick"));
      btn.classList.add("pick");
      const item = items[Number(btn.dataset.i)];
      selectOffer(kind, item);
    });
  });
}

function selectOffer(kind, item, row) {
  if (playing) return;
  if (kind === "digital" && (item.priceUsd == null || item.priceUsd === 0)) {
    addBubble($("feedBuyer"), "sys", `${item.name} is listed at $0 — catalog only.`);
    return;
  }
  pending = { kind, item };
  if (row) highlightRow(row);
  askApproval();
}

function askApproval() {
  if (!pending) return;
  const { kind, item } = pending;
  const title = offerTitle(kind, item);
  const price = offerPrice(kind, item);
  const wrap = addHtml(
    $("feedBuyer"),
    `<div>Pay <b>${esc(title)}</b> (${esc(kind === "shopify" ? `$${price.toFixed(2)}` : fmtUsd(price))}) from which wallet?</div>
     <div class="approve-row">
       <button type="button" class="approve-btn" data-rail="crypto">Crypto · USDC</button>
       <button type="button" class="approve-btn" data-rail="fiat">Fiat · Stripe</button>
       <button type="button" class="approve-btn reject" data-decision="reject">Reject</button>
     </div>`,
    "inc",
    "human",
  );
  wrap.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      wrap.querySelectorAll(".approve-btn").forEach((b) => (b.disabled = true));
      if (btn.dataset.decision === "reject" || !btn.dataset.rail) {
        pending = null;
        addBubble($("feedBuyer"), "inc", "Rejected. Tap another listing or tell me what to get.", "Ledger Agent");
        return;
      }
      const paymentRail = btn.dataset.rail;
      addBubble($("feedBuyer"), "out", paymentRail === "fiat" ? "Approved · fiat" : "Approved · crypto", "you");
      const extra =
        pending.kind === "shopify"
          ? { shopifyOffer: pending.item, maxSpendUsd: pending.item.priceCents / 100, paymentRail }
          : {
              marketplaceListing: pending.item,
              maxSpendUsd: Math.max((pending.item.priceUsd || 0.01) * 2, 0.05),
              paymentRail,
            };
      const prompt =
        pending.kind === "shopify"
          ? lastPrompt || `Buy ${pending.item.title}`
          : `Buy ${offerTitle("digital", pending.item)}. Spend up to $${extra.maxSpendUsd}`;
      pending = null;
      await runTransaction(prompt, extra);
    });
  });
}

async function browseCategory(category) {
  if (playing) return;
  activeCategory = category;
  $("categoryRow").querySelectorAll(".cat-chip").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cat === category);
  });
  await onSubmit("", { category, reset: true });
}

async function loadIdentities() {
  const res = await fetch("/api/identities");
  identities = await res.json();
  if ($("modePill")) $("modePill").textContent = identities.paymentMode || "adapter";
  const buyerWallet = identities.wallets?.buyer;
  const sellerWallet = identities.wallets?.seller;
  const buyerUsdc = buyerWallet?.usdc == null ? null : Number(buyerWallet.usdc).toFixed(2);
  $("buyerSub").textContent = buyerUsdc == null ? "Circle Agent Wallet" : `${buyerUsdc} USDC`;
  $("buyerWalletChip").textContent = buyerUsdc == null
    ? shortAddr(buyerWallet?.address)
    : `${buyerUsdc} · ${shortAddr(buyerWallet?.address)}`;
  const sellerUsdc = sellerWallet?.usdc == null ? null : Number(sellerWallet.usdc).toFixed(2);
  $("sellerSub").textContent = sellerUsdc == null
    ? `Agent Wallet · ${sellerWallet?.address || "unassigned"}`
    : `${sellerUsdc} USDC · ${sellerWallet?.address || "unassigned"}`;
  $("buyerPopover").innerHTML = kvHtml("SHOPPING AGENT · ERC-8004", {
    Name: identities.buyer.name || "Shopping Agent",
    Token: identities.buyer.scanUrl
      ? { href: identities.buyer.scanUrl, label: `#${identities.buyer.agentId}` }
      : `#${identities.buyer.agentId}`,
    Character: identities.buyer.character || "missing",
    Why: identities.buyer.characterDetail || "—",
    Identity: identities.buyer.identityVerified ? "live" : "missing",
    Active: identities.buyer.isActive ? "yes" : "no",
    Publisher: identities.buyer.publisherVerified ? "verified" : "unverified",
    Source: identities.buyer.source || "adapter",
    x402: identities.buyer.x402Supported ? "yes" : "no",
    Feedback: identities.buyer.reputationSignals,
    Validations: identities.buyer.validationSignals,
  }) + scanLink(identities.buyer.scanUrl);
  $("sellerPopover").innerHTML = kvHtml("MERCHANT AGENT · ERC-8004", {
    Name: identities.seller.name || "Merchant Agent",
    Token: identities.seller.scanUrl
      ? { href: identities.seller.scanUrl, label: `#${identities.seller.agentId}` }
      : `#${identities.seller.agentId}`,
    Character: identities.seller.character || "missing",
    Why: identities.seller.characterDetail || "—",
    Identity: identities.seller.identityVerified ? "live" : "missing",
    Active: identities.seller.isActive ? "yes" : "no",
    Publisher: identities.seller.publisherVerified ? "verified" : "unverified",
    Source: identities.seller.source || "adapter",
    x402: identities.seller.x402Supported ? "yes" : "no",
    Feedback: identities.seller.reputationSignals,
    Validations: identities.seller.validationSignals,
  }) + scanLink(identities.seller.scanUrl);
  await refreshReceipts();
  await refreshLedger();
  renderWalletPop("buyer");
  renderWalletPop("seller");
}

document.querySelectorAll(".popover, .wallet-sheet, .profile-sheet").forEach((el) => {
  el.addEventListener("click", (e) => {
    const link = e.target.closest("a[href]");
    if (link) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
  });
});
document.querySelectorAll(".pop-wrap").forEach((wrap) => {
  wrap.querySelector("button").addEventListener("click", async (e) => {
    e.stopPropagation();
    const open = wrap.classList.contains("open");
    document.querySelectorAll(".pop-wrap").forEach((w) => w.classList.remove("open"));
    if (!open) {
      wrap.classList.add("open");
      if (wrap.id === "buyerWalletWrap" || wrap.id === "sellerWalletWrap") {
        await refreshReceipts();
        renderWalletPop(wrap.id === "buyerWalletWrap" ? "buyer" : "seller");
      }
    }
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll(".pop-wrap").forEach((w) => w.classList.remove("open"));
});
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => setSellerTab(btn.dataset.tab));
});
document.querySelectorAll(".prompt-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (playing) return;
    onSubmit(btn.dataset.q, { reset: true });
  });
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = $("q").value.trim();
  if (!prompt || playing) return;
  await onSubmit(prompt);
});

async function onSubmit(prompt, opts = {}) {
  playing = true;
  $("form").querySelector("button").disabled = true;
  const followUp = clarifying && sessionId && !opts.reset && !opts.category;
  if (!followUp) {
    $("feedBuyer").innerHTML = "";
    resetPhases();
    setRail(null);
    sessionId = null;
    pending = null;
  }
  if (prompt) {
    lastPrompt = prompt;
    addBubble($("feedBuyer"), "out", prompt, "you");
    lockChoices(prompt);
  }
  $("q").value = "";
  lightPhase("intent");

  let data;
  try {
    data = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        sessionId: followUp ? sessionId : null,
        category: opts.category || undefined,
      }),
    }).then((r) => r.json());
  } catch (err) {
    addBubble($("feedBuyer"), "sys", String(err));
    playing = false;
    $("form").querySelector("button").disabled = false;
    return;
  }

  sessionId = data.sessionId;
  if (data.stopReason !== "ready") {
    clarifying = true;
    addAgentAsk(data.agentMessage, data.options);
    playing = false;
    $("form").querySelector("button").disabled = false;
    return;
  }

  clarifying = false;
  lastCatalog = {
    digital: data.digital || [],
    shopify: data.shopify || [],
    digitalMeta: data.digitalMeta || null,
  };
  lightPhase("discover");

  if (data.shopify?.length) {
    await setSellerTab("shopify", { stagger: true });
    if (data.agentMessage && !/^Searching Shopify/i.test(data.agentMessage)) {
      addBubble($("feedBuyer"), "inc", data.agentMessage, "ARC Agent");
    }
    renderChatOffers("shopify", data.shopify);
    playing = false;
    $("form").querySelector("button").disabled = false;
    return;
  }
  const micro =
    data.parsed?.serviceType === "financial-data" ||
    (typeof data.parsed?.maxPriceCents === "number" && data.parsed.maxPriceCents <= 100 && data.parsed.channel === "digital");
  if (micro) {
    await setSellerTab("digital", { skipRender: true });
    const chart = /ohlc|candle|chart/i.test(lastPrompt || prompt);
    addBubble($("feedBuyer"), "inc", chart
      ? "Paying the Arc x402 seller for ETH OHLC…"
      : "Paying the Arc x402 seller for an ETH tick…", "ARC Agent");
    playing = false;
    await runTransaction(lastPrompt || prompt, {
      maxSpendUsd: data.parsed?.maxPriceCents ? data.parsed.maxPriceCents / 100 : 0.05,
    });
    return;
  }
  if (data.digital?.length) {
    if (data.parsed?.category) {
      activeCategory = data.parsed.category;
      $("categoryRow").querySelectorAll(".cat-chip").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.cat === activeCategory);
      });
    }
    await setSellerTab("digital", { stagger: true });
    addBubble($("feedBuyer"), "inc", data.agentMessage || `Found ${data.digital.length} Circle listings.`, "ARC Agent");
    renderChatOffers("digital", data.digital);
    playing = false;
    $("form").querySelector("button").disabled = false;
    return;
  }
  addBubble($("feedBuyer"), "inc", data.agentMessage || "Nothing matched that. Try another ask.", "ARC Agent");

  playing = false;
  $("form").querySelector("button").disabled = false;
}

function paymentCopy(result) {
  const rail = result.policy?.rail;
  const outcome = result.receipt?.outcome;
  const amount = result.payment?.amountUsd;
  const paid = Number(amount) > 0 || Boolean(result.payment?.settleTxHash || result.receipt?.paymentTxHash);
  if (result.policy?.decision === "REJECT") {
    return (result.policy.reasons || [])[0] || "Fail closed. No payment sent.";
  }
  if (result.payment?.scheme === "stripe" || result.receipt?.currency === "USD") {
    const last4 = result.payment?.stripe?.cardLast4 || "4242";
    if (outcome === "FAILED") return result.payment?.note || "Stripe charge failed.";
    return `Paid $${amount} USD from the Stripe fiat wallet (Visa ···${last4}).`;
  }
  if (rail === "DIRECT") {
    if (outcome === "FAILED") {
      return paid
        ? "Paid, but independent verification rejected the payload."
        : "Seller failed. Nanopayment was not sent. Seller received 0 USDC.";
    }
    return `Paid ${amount} USDC from your Agent Wallet.`;
  }
  if (result.awaitingDelivery || outcome === "HELD") {
    return `${amount} USDC locked in operator escrow. Seller cannot spend until you confirm delivery.`;
  }
  if (outcome === "VOIDED") {
    return `Dispute raised. ${amount} USDC refunded to your Agent Wallet. Seller was not paid.`;
  }
  return `${amount} USDC released from escrow to the seller.`;
}

function lightStages(result) {
  setRail(result.policy, result.payment);
  for (const stage of result.stages || []) {
    if (stage.status === "pending") continue;
    lightPhase(phaseMap[stage.id] || stage.id, stage.status === "failed");
  }
}

function showDeliverable(result) {
  if (result.policy?.decision === "REJECT") return;
  if (result.verification && !result.verification.verified) return;
  const delivered = result.seller?.body || {};
  if (delivered.price != null) {
    addQuoteHero($("feedBuyer"), delivered);
  } else if (delivered.summary) {
    addBubble($("feedBuyer"), "inc", String(delivered.summary), "ARC Agent");
  } else if (delivered.orderId) {
    addBubble($("feedBuyer"), "inc", `Order ${delivered.orderId} · ${delivered.title || "Shopify"}`, "ARC Agent");
  }
}

function showVerification(result) {
  if (!result.verification) return;
  const checks = result.verification.checks || {};
  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const rows = {
    Result: result.verification.verified ? "PASSED" : "FAILED",
    Checks: `${passed}/${total} pass`,
    ...Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v ? "pass" : "fail"])),
  };
  addCollapseCard(
    $("feedBuyer"),
    "Verification",
    result.verification.verified ? `PASSED · ${passed}/${total}` : `FAILED · ${passed}/${total}`,
    rows,
  );
}

function showReceipt(result) {
  if (!result.receipt) return;
  const fiat = result.payment?.scheme === "stripe" || result.receipt.currency === "USD";
  const unit = fiat ? "USD" : result.receipt.currency || "USDC";
  const tx = result.payment?.stripe?.paymentIntentId || result.receipt.paymentTxHash;
  addCollapseCard($("feedBuyer"), "Receipt", `${result.receipt.outcome} · ${result.receipt.amount} ${unit}`, {
    Service: result.receipt.service,
    Amount: `${result.receipt.amount} ${unit}`,
    Rail: fiat ? "Stripe" : result.receipt.rail,
    Network: result.receipt.network || (fiat ? "Stripe" : "Arc"),
    Status: result.receipt.outcome,
    Tx: tx,
    Dashboard: result.payment?.stripe?.dashboardUrl || result.receipt.explorerUrl || "",
    Mode: fiat ? "stripe" : result.receipt.paymentMode,
  });
  refreshLedger();
}

function closeDeliveryModal() {
  const modal = $("deliveryModal");
  if (modal?.open) modal.close();
}

function askDelivery(result) {
  const modal = $("deliveryModal");
  const yes = $("deliveryYes");
  const no = $("deliveryNo");
  if (!modal || !yes || !no) return;
  yes.disabled = false;
  no.disabled = false;
  const pick = async (received) => {
    yes.disabled = true;
    no.disabled = true;
    closeDeliveryModal();
    addBubble($("feedBuyer"), "out", received ? "Yes" : "No", "you");
    await settleDelivery(result.runId, received);
  };
  yes.onclick = () => pick(true);
  no.onclick = () => pick(false);
  if (typeof modal.showModal === "function") {
    if (!modal.open) modal.showModal();
    return;
  }
  modal.setAttribute("open", "");
}

async function settleDelivery(runId, received) {
  playing = true;
  $("form").querySelector("button").disabled = true;
  addBubble(
    $("feedBuyer"),
    "inc",
    received ? "Releasing escrow to the seller…" : "Dispute raised. Refunding escrow to your Agent Wallet…",
    "ARC Agent",
  );
  try {
    const res = await fetch(`/api/transactions/${runId}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ received }),
    });
    const result = await res.json();
    if (!res.ok || result.error) {
      addBubble($("feedBuyer"), "sys", result.error || `Settle failed (${res.status})`);
      playing = false;
      $("form").querySelector("button").disabled = false;
      return;
    }
    lightStages(result);
    if (result.payment) addBubble($("feedBuyer"), "inc", paymentCopy(result), "ARC Agent");
    showReceipt(result);
    await loadIdentities();
  } catch (err) {
    addBubble($("feedBuyer"), "sys", String(err));
  }
  playing = false;
  $("form").querySelector("button").disabled = false;
  sessionId = null;
}

async function runTransaction(prompt, extra = {}) {
  playing = true;
  $("form").querySelector("button").disabled = true;
  const payingFiat = extra.paymentRail === "fiat";
  addBubble(
    $("feedBuyer"),
    "inc",
    payingFiat
      ? "Charging the Stripe fiat wallet…"
      : extra.shopifyOffer
        ? "Placing the commerce order…"
        : looksLikeLiveEth(prompt)
          ? "Paying the Arc x402 seller…"
          : "Checking whether the Arc seller can answer that…",
    "ARC Agent",
  );

  let result;
  try {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        simulateFailure: $("failToggle").checked,
        maxSpendUsd: extra.maxSpendUsd,
        shopifyOffer: extra.shopifyOffer,
        marketplaceListing: extra.marketplaceListing,
        paymentRail: extra.paymentRail || "crypto",
      }),
    });
    result = await res.json();
    if (!res.ok || result.error) {
      addBubble($("feedBuyer"), "sys", result.error || `Payment failed (${res.status})`);
      playing = false;
      $("form").querySelector("button").disabled = false;
      return;
    }
  } catch (err) {
    addBubble($("feedBuyer"), "sys", String(err));
    playing = false;
    $("form").querySelector("button").disabled = false;
    return;
  }

  lightStages(result);
  if (result.policy) {
    const stripe = result.payment?.scheme === "stripe";
    const rail = stripe ? "Stripe" : result.policy.rail === "DIRECT" ? "Nanopayment" : "Escrow";
    addCollapseCard(
      $("feedBuyer"),
      "Policy",
      `${result.policy.decision} · ${rail}`,
      {
        Decision: result.policy.decision,
        Rail: stripe ? "Stripe test Visa ···4242" : result.policy.rail === "DIRECT" ? "Nanopayment" : "AuthCapture escrow",
      },
      { listLabel: "Why", list: result.policy.reasons },
    );
  }
  if (result.policy?.decision === "REJECT") {
    addBubble($("feedBuyer"), "sys", paymentCopy(result));
    showReceipt(result);
    await loadIdentities();
    playing = false;
    $("form").querySelector("button").disabled = false;
    sessionId = null;
    return;
  }
  if (result.payment) addBubble($("feedBuyer"), "inc", paymentCopy(result), "ARC Agent");
  showDeliverable(result);
  showVerification(result);
  if (result.awaitingDelivery) {
    showReceipt(result);
    await sleep(tourActive ? 4500 : 2500);
    askDelivery(result);
    await loadIdentities();
    return;
  }
  showReceipt(result);
  await loadIdentities();
  playing = false;
  $("form").querySelector("button").disabled = false;
  sessionId = null;
}

function looksLikeLiveEth(prompt) {
  const t = String(prompt || "");
  if (/\b(btc|bitcoin)\b/i.test(t)) return false;
  return /\beth\b|ethereum|ohlc|spot|chart/i.test(t);
}

let tourActive = false;
let tourResolveNext = null;
let tourToken = 0;

function clearTourHighlight() {
  document.querySelectorAll(".tour-pulse").forEach((el) => el.classList.remove("tour-pulse"));
  const spot = $("tourSpot");
  if (spot) {
    spot.style.opacity = "0";
  }
}

function placeTourTip(target) {
  const tip = $("tourTip");
  const spot = $("tourSpot");
  if (!tip || !spot) return;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (target) {
    const r = target.getBoundingClientRect();
    spot.style.opacity = "1";
    spot.style.top = `${Math.max(4, r.top - pad)}px`;
    spot.style.left = `${Math.max(4, r.left - pad)}px`;
    spot.style.width = `${Math.min(vw - 8, r.width + pad * 2)}px`;
    spot.style.height = `${Math.min(vh - 8, r.height + pad * 2)}px`;
    target.classList.add("tour-pulse");
    const tipW = Math.min(320, vw - 24);
    let left = Math.min(vw - tipW - 12, Math.max(12, r.left));
    let top = r.bottom + 14;
    if (top + 180 > vh) top = Math.max(12, r.top - 190);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  } else {
    spot.style.opacity = "0";
    tip.style.left = `${Math.max(12, (vw - 320) / 2)}px`;
    tip.style.top = `${Math.max(24, vh * 0.28)}px`;
  }
}

function openTourUi() {
  const root = $("tourRoot");
  if (!root) return;
  root.hidden = false;
}

function closeTourUi() {
  const root = $("tourRoot");
  if (root) root.hidden = true;
  clearTourHighlight();
  if (tourResolveNext) {
    tourResolveNext();
    tourResolveNext = null;
  }
}

async function waitForSelector(selector, { timeout = 45000, predicate } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!tourActive) throw new Error("tour-aborted");
    const el = document.querySelector(selector);
    if (el && (!predicate || predicate(el))) return el;
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function waitWhileBusy(timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!tourActive) throw new Error("tour-aborted");
    if (!playing) return;
    await sleep(120);
  }
  throw new Error("Timed out waiting for the demo to finish a step");
}

function waitForTourNext(autoMs = 0) {
  return new Promise((resolve) => {
    tourResolveNext = () => {
      tourResolveNext = null;
      resolve("next");
    };
    if (autoMs > 0) {
      setTimeout(() => {
        if (tourResolveNext) {
          tourResolveNext();
        }
      }, autoMs);
    }
  });
}

async function runTourStep({ step, total, title, body, target, nextLabel = "Next", autoMs = 4500, action }) {
  if (!tourActive) return;
  clearTourHighlight();
  $("tourStep").textContent = `${step} / ${total}`;
  $("tourTitle").textContent = title;
  $("tourBody").textContent = body;
  $("tourNext").textContent = nextLabel;
  placeTourTip(target || null);
  // Let the highlight settle before the countdown feels urgent.
  await sleep(500);
  if (!tourActive) return;
  await waitForTourNext(autoMs);
  if (!tourActive) return;
  if (typeof action === "function") {
    await action();
    // Give people time to watch the UI react after each click.
    await sleep(1200);
  }
}

function closeAllPops() {
  document.querySelectorAll(".pop-wrap").forEach((w) => w.classList.remove("open"));
}

async function openBuyerProfile() {
  closeAllPops();
  $("buyerProfileWrap")?.classList.add("open");
}

async function openSellerProfile() {
  closeAllPops();
  $("sellerProfileWrap")?.classList.add("open");
}

async function openBuyerWallet() {
  closeAllPops();
  await refreshReceipts();
  renderWalletPop("buyer");
  $("buyerWalletWrap")?.classList.add("open");
}

async function startLedgerTutorial() {
  if (tourActive || playing) return;
  const token = ++tourToken;
  tourActive = true;
  $("tutorialBtn").disabled = true;
  const fail = $("failToggle");
  if (fail) fail.checked = false;
  closeDeliveryModal();
  closeAllPops();
  openTourUi();

  const total = 6;
  try {
    await runTourStep({
      step: 1,
      total,
      title: "Rho credit for agents",
      body: "Prepaid agent payments are the present. AgentLedger joins each spend to Rho so character, capacity, collateral, and condition can underwrite a future credit line.",
      target: $("buyerPanel"),
      nextLabel: "Start",
      autoMs: 0,
    });
    if (!tourActive || token !== tourToken) return;

    const chip = document.querySelector('.prompt-chip[data-q="Find me chocolates under $10"]');
    await runTourStep({
      step: 2,
      total,
      title: "Create a real spend",
      body: "Buy chocolates. The order is commerce; the settlement is what Rho (or a labeled fixture) records.",
      target: chip,
      nextLabel: "Click chocolates",
      autoMs: 5000,
      action: () => chip?.click(),
    });
    if (!tourActive || token !== tourToken) return;

    clearTourHighlight();
    $("tourBody").textContent = "Listings load. Pick one, then pay from the Stripe fiat wallet.";
    $("tourTitle").textContent = "Commerce";
    $("tourStep").textContent = `3 / ${total}`;
    placeTourTip($("sellerPanel"));
    await waitWhileBusy();
    await sleep(800);
    const offer = await waitForSelector(".chat-offer.pick, .chat-offer");
    if (!tourActive || token !== tourToken) return;

    await runTourStep({
      step: 3,
      total,
      title: "Pick the item",
      body: "This is the commerce-layer claim. Rho later confirms whether money actually moved.",
      target: offer,
      nextLabel: "Select",
      autoMs: 4500,
      action: () => offer?.click(),
    });
    if (!tourActive || token !== tourToken) return;

    const fiat = await waitForSelector('button.approve-btn[data-rail="fiat"]');
    await runTourStep({
      step: 4,
      total,
      title: "Fiat wallet",
      body: "Crypto is Circle USDC. Fiat is Stripe test Visa ···4242. Both wallets exist on buyer and seller. We charge fiat so Rho can see a prepaid card spend.",
      target: fiat,
      nextLabel: "Pay with Stripe",
      autoMs: 6000,
      action: () => fiat?.click(),
    });
    if (!tourActive || token !== tourToken) return;

    clearTourHighlight();
    $("tourTitle").textContent = "Recording";
    $("tourBody").textContent = "The charge is stored in the ledger database and scored on the 4Cs.";
    $("tourStep").textContent = `5 / ${total}`;
    placeTourTip($("feedBuyer"));
    await waitWhileBusy();
    await sleep(1200);
    if (!tourActive || token !== tourToken) return;

    const ledgerBtn = document.querySelector('.tab-btn[data-tab="ledger"]');
    await runTourStep({
      step: 5,
      total,
      title: "CFO ledger",
      body: "Every crypto and fiat payment lands here: P&L, 4C scores, and a suggested credit line. Today it is still prepaid. The file is what lets Rho extend credit later.",
      target: ledgerBtn,
      nextLabel: "Open ledger",
      autoMs: 5500,
      action: () => ledgerBtn?.click(),
    });
    if (!tourActive || token !== tourToken) return;

    await runTourStep({
      step: 6,
      total,
      title: "Who gets more money?",
      body: "Character · Capacity · Collateral · Condition. Open Scorecard for the full Rho join and transaction history.",
      target: $("sellerPanel"),
      nextLabel: "Done",
      autoMs: 0,
    });
  } catch (err) {
    if (String(err.message || err) !== "tour-aborted") {
      addBubble($("feedBuyer"), "sys", `Tutorial stopped: ${err.message || err}`);
    }
  } finally {
    tourActive = false;
    closeAllPops();
    closeTourUi();
    $("tutorialBtn").disabled = false;
  }
}

$("tutorialBtn")?.addEventListener("click", () => {
  startLedgerTutorial();
});
$("tourSkip")?.addEventListener("click", () => {
  tourActive = false;
  tourToken += 1;
  closeTourUi();
  $("tutorialBtn").disabled = false;
});
$("tourNext")?.addEventListener("click", () => {
  if (tourResolveNext) tourResolveNext();
});
window.addEventListener("resize", () => {
  if (!tourActive) return;
  const pulsed = document.querySelector(".tour-pulse");
  placeTourTip(pulsed);
});

fillCategories();
loadIdentities().catch(() => {
  if ($("modePill")) $("modePill").textContent = "offline";
});
