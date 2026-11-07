// The page is a window, not a wallet. Keys live on the local demo server.
// Five screens: home, setup, shop, report, audit. Hash router, no framework.

const $ = (s) => document.querySelector(s);
const RATE = 200; // DEMO_USD_PER_SOL, locked for the weekend

const sol = (lamports) => `${(lamports / 1e9).toFixed(4)} SOL`;
const usd = (lamports) => `$${((lamports / 1e9) * RATE).toFixed(2)}`;
const explorerAddr = (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
const explorerTx = (t) => `https://explorer.solana.com/tx/${t}?cluster=devnet`;
const short = (a) => `${a.slice(0, 4)}...${a.slice(-4)}`;

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}
const post = (path, payload) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });

let STATE = null;
let currentTask = null; // { id, record, timer }
let lastReport = null;

// ---------- router ----------
const routes = {
  "/": "screen-home",
  "/setup": "screen-setup",
  "/shop": "screen-shop",
  "/report": "screen-report",
  "/audit": "screen-audit",
};

function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const id = routes[hash] || "screen-home";
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.getAttribute("href") === `#${hash}`)
  );
  if (id === "screen-setup") renderSetup();
  if (id === "screen-audit") renderAudit();
  if (id === "screen-report") renderReport();
}
window.addEventListener("hashchange", route);

// ---------- state ----------
async function refreshState() {
  try {
    STATE = await api("/api/state");
    $("#vault-chip").textContent = `vault ${short(STATE.vault.address)}`;
    renderMeter();
  } catch (e) {
    $("#vault-chip").textContent = "demo server offline";
  }
}

function renderMeter() {
  if (!STATE) return;
  const { spent, budget } = STATE.vault;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  $("#meter-fill").style.width = `${pct}%`;
  $("#meter-label").textContent = `${sol(spent)} (${usd(spent)}) of ${sol(budget)}`;
}

// ---------- setup screen ----------
function renderSetup() {
  if (!STATE) return;
  const v = STATE.vault;
  const rows = [
    ["Vault exists", true, short(v.address)],
    ["Rules set", v.rulesSet, v.rulesSet ? `cap ${sol(v.cap)}, auto ${sol(v.auto)}, budget ${sol(v.budget)}` : "the vault fails closed"],
    ["Agent registered", v.agent !== "11111111111111111111111111111111", short(v.agent)],
    ["Vendors allowlisted", v.payees.length >= 2, v.payees.map(short).join(", ")],
    ["Vault funded", v.balance > 300_000_000, `${sol(v.balance)} on the vault account`],
  ];
  $("#setup-steps").innerHTML = rows
    .map(
      ([label, done, detail]) => `
      <div class="setup-row ${done ? "done" : ""}">
        <div class="box">${done ? "&#10003;" : ""}</div>
        <div><b>${label}</b><div class="detail">${detail}</div></div>
        <a class="pill ${done ? "SETTLED" : "QUEUED"}" href="${explorerAddr(v.address)}" target="_blank">${done ? "ON CHAIN" : "PENDING"}</a>
      </div>`
    )
    .join("");
}

$("#btn-setup").addEventListener("click", async (ev) => {
  ev.target.disabled = true;
  $("#setup-note").textContent = "running setup transactions on devnet...";
  try {
    await post("/api/setup");
    $("#setup-note").textContent = "setup done";
    await refreshState();
    renderSetup();
  } catch (e) {
    $("#setup-note").textContent = `failed: ${e.message}`;
  }
  ev.target.disabled = false;
});

$("#btn-topup").addEventListener("click", async (ev) => {
  ev.target.disabled = true;
  $("#setup-note").textContent = "owner is re-setting the budget above current spend...";
  try {
    const out = await post("/api/topup");
    $("#setup-note").textContent = `budget topped up to ${sol(out.newBudget)}`;
    await refreshState();
    renderSetup();
  } catch (e) {
    $("#setup-note").textContent = `failed: ${e.message}`;
  }
  ev.target.disabled = false;
});

// ---------- shop screen ----------
async function loadTasks() {
  const { tasks } = await api("/api/tasks");
  $("#task-cards").innerHTML = tasks
    .map(
      (t) => `
      <button class="task-card" data-task="${t.id}">
        <b>${t.title.toUpperCase()}</b>
        <span>${t.desc}</span>
      </button>`
    )
    .join("");
  for (const btn of document.querySelectorAll("[data-task]")) {
    btn.addEventListener("click", () => startTask(btn.dataset.task, btn));
  }
  if (STATE) {
    $("#vendor-cards").innerHTML = `
      <div class="vendor-item"><b>Market data vendor</b>0.002 SOL per call<br/><span class="mono">${short(STATE.addresses.vendor1)}</span></div>
      <div class="vendor-item"><b>Research vendor</b>0.03 SOL per digest<br/><span class="mono">${short(STATE.addresses.vendor2)}</span></div>`;
  }
}

async function startTask(taskId, btn) {
  document.querySelectorAll("[data-task]").forEach((b) => (b.disabled = true));
  $("#feed").innerHTML = "";
  $("#approval-slot").innerHTML = "";
  $("#plan-card").style.display = "none";
  try {
    const { taskId: runId } = await post("/api/task", { taskId });
    currentTask = { id: runId, seen: 0 };
    pollTask(btn);
  } catch (e) {
    feedRow("info", `task failed to start: ${e.message}`);
    document.querySelectorAll("[data-task]").forEach((b) => (b.disabled = false));
  }
}

async function pollTask(btn) {
  if (!currentTask) return;
  let rec;
  try {
    rec = await api(`/api/task?id=${currentTask.id}`);
  } catch (e) {
    feedRow("info", `poll failed: ${e.message}`);
    return;
  }
  while (currentTask.seen < rec.events.length) {
    renderEvent(rec.events[currentTask.seen]);
    currentTask.seen++;
  }
  await refreshState();
  if (rec.status === "running") {
    setTimeout(() => pollTask(btn), 1500);
    return;
  }
  document.querySelectorAll("[data-task]").forEach((b) => (b.disabled = false));
  if (rec.status === "error") {
    feedRow("info", `task error: ${rec.error}`);
    return;
  }
  lastReport = rec.report;
  feedRow("delivery", `report assembled. open the REPORT screen to read it with the full ledger.`);
  $("#approval-slot").innerHTML = "";
}

function feedRow(cls, html) {
  const empty = $("#feed .feed-empty");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = `feed-row ${cls}`;
  div.innerHTML = html;
  $("#feed").appendChild(div);
  $("#feed").scrollTop = $("#feed").scrollHeight;
}

function renderEvent(e) {
  if (e.type === "plan") {
    $("#plan-card").style.display = "block";
    $("#plan-list").innerHTML = e.cart
      .map((i) => `<span class="chip">${i.label} &middot; ${sol(i.amount)}</span>`)
      .join("");
    feedRow("info", `<b>PLAN</b> ${e.cart.length} purchases planned for this task`);
  }
  if (e.type === "purchase") {
    feedRow(
      "",
      `<span class="what">${e.label}</span>
       <span class="amt">${sol(e.amount)} <a href="${explorerTx(e.sig)}" target="_blank">tx</a></span>
       <span class="pill ${e.status}" title="${e.reason}">${e.status}</span>`
    );
  }
  if (e.type === "awaiting") {
    $("#approval-slot").innerHTML = `
      <div class="approval-card">
        <div><b>${e.label.toUpperCase()} &middot; ${sol(e.amount)} (${usd(e.amount)})</b><br/>
        Above the auto-approve line. The agent cannot approve its own request. You can.</div>
        <div class="row" style="margin:0;">
          <button class="btn green" id="btn-approve">APPROVE</button>
          <button class="btn red" id="btn-refuse">REFUSE</button>
        </div>
      </div>`;
    $("#btn-approve").addEventListener("click", async () => {
      $("#btn-approve").disabled = true;
      try {
        await post("/api/approve", { receipt: e.receipt });
        $("#approval-slot").innerHTML = "";
        feedRow("delivery", `<b>OWNER APPROVED</b> ${e.label}, the vault re-checked the rules and paid`);
      } catch (err) {
        feedRow("info", `approve failed: ${err.message}`);
        $("#btn-approve").disabled = false;
      }
    });
    $("#btn-refuse").addEventListener("click", async () => {
      $("#btn-refuse").disabled = true;
      try {
        await post("/api/refuse", { receipt: e.receipt, reason: "the owner refused this on the shop page" });
        $("#approval-slot").innerHTML = "";
        feedRow("info", `<b>OWNER REFUSED</b> ${e.label}, the refusal is a receipt too`);
      } catch (err) {
        feedRow("info", `refuse failed: ${err.message}`);
        $("#btn-refuse").disabled = false;
      }
    });
  }
  if (e.type === "decision") {
    feedRow("info", `<b>DECISION</b> ${e.label}: ${e.status} (${e.reason})`);
  }
  if (e.type === "delivery") {
    feedRow("delivery", `<span class="what">delivered: ${e.delivered}</span><span class="amt"><a href="${explorerAddr(e.receipt)}" target="_blank">receipt</a></span><span class="pill SETTLED">DATA OUT</span>`);
  }
  if (e.type === "report") {
    lastReport = e.report;
  }
}

// ---------- report screen ----------
function renderReport() {
  if (!lastReport) {
    $("#report-body").innerHTML = `<p class="lede">No finished task yet. Run one in the shop.</p>`;
    return;
  }
  const r = lastReport;
  $("#report-body").innerHTML = `
    <div class="card hard" style="margin-bottom:18px;">
      <h3>${r.title.toUpperCase()}</h3>
      <ul class="report-summary">${r.summary.map((l) => `<li>${l}</li>`).join("")}</ul>
    </div>
    <div class="card hard">
      <h3>PURCHASE LEDGER</h3>
      <table class="ledger">
        <thead><tr><th>ITEM</th><th>AMOUNT</th><th>STATUS</th><th>DELIVERED</th><th>RECEIPT</th></tr></thead>
        <tbody>
          ${r.ledger
            .map(
              (l) => `<tr>
                <td>${l.label}</td>
                <td class="mono">${sol(l.amount)}</td>
                <td><span class="pill ${l.status}">${l.status}</span></td>
                <td>${l.delivered || "&mdash;"}</td>
                <td><a href="${explorerAddr(l.receipt)}" target="_blank">open</a></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <p class="note" style="margin-top:10px;">Total spent on this task: <b class="mono">${sol(r.totalSpent)} (${usd(r.totalSpent)})</b>. Every row is an account on devnet.</p>
    </div>`;
}

// ---------- audit screen ----------
function renderAudit() {
  if (!STATE) return;
  const v = STATE.vault;
  const rows = [
    ["Cap per purchase", `${sol(v.cap)} (${usd(v.cap)})`],
    ["Auto-approve line", `${sol(v.auto)} (${usd(v.auto)})`],
    ["Budget", `${sol(v.budget)} (${usd(v.budget)})`],
    ["Spent", `${sol(v.spent)} (${usd(v.spent)})`],
    ["Rules set", v.rulesSet ? "yes" : "no, fails closed"],
    ["Receipts written", String(v.receiptCounter)],
    ["Vault", `<a href="${explorerAddr(v.address)}" target="_blank">${short(v.address)}</a>`],
  ];
  $("#rules-list").innerHTML = rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join("");
  $("#payees").innerHTML = v.payees.map((p) => `<li><a href="${explorerAddr(p)}" target="_blank">${p}</a></li>`).join("");
  const tbody = document.querySelector("#receipt-table tbody");
  tbody.innerHTML = STATE.receipts
    .slice()
    .reverse()
    .map(
      (r) => `<tr>
        <td>${String(r.counter).padStart(2, "0")}</td>
        <td><span class="pill ${r.status}">${r.status}</span></td>
        <td class="mono">${sol(r.amount)}</td>
        <td>${r.purpose}</td>
        <td>${r.reason}</td>
        <td><a href="${explorerAddr(r.key)}" target="_blank">open</a></td>
      </tr>`
    )
    .join("");
}

// ---------- boot ----------
(async function boot() {
  await refreshState();
  route();
  loadTasks().catch((e) => console.error("task catalog failed", e));
  setInterval(refreshState, 10000);
})();
