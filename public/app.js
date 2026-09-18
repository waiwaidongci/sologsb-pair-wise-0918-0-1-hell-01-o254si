"use strict";

const state = {
  clocks: [],
  filter: "all",
  search: "",
  selectedId: null
};

const STATUS_META = {
  NEEDS_ADJUSTMENT: {
    label: "待调校",
    badge: "badge-need",
    banner: "banner-need",
    hint: "尚未登记调校，或等待开始新一轮调校。"
  },
  AWAITING_RETEST: {
    label: "待复测",
    badge: "badge-wait",
    banner: "banner-wait",
    hint: "调校进行中，请在约定复测时间到达后登记复测；每项调校仅可复测一次。"
  },
  RETEST_FAILED: {
    label: "复测未达标",
    badge: "badge-fail",
    banner: "banner-fail",
    hint: "复测结果未达目标，必须先重新调校，不能再次复测原调校项。"
  },
  READY_FOR_DELIVERY: {
    label: "待交付",
    badge: "badge-ready",
    banner: "banner-ready",
    hint: "复测已达标，进入待交付。若重新登记调校，交付状态将立即失效。"
  }
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- 工具 ---------------- */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
}

function signedRate(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return `${n > 0 ? "+" : ""}${n} 秒/天`;
}

function stuckDuration(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t) || now <= t) return "";
  const minsTotal = Math.floor((now - t) / 60000);
  const days = Math.floor(minsTotal / (60 * 24));
  const hours = Math.floor((minsTotal % (60 * 24)) / 60);
  const mins = minsTotal % 60;
  if (days >= 1) return `滞留 ${days} 天 ${hours} 小时`;
  if (hours >= 1) return `滞留 ${hours} 小时 ${mins} 分`;
  return `滞留 ${mins} 分钟`;
}

function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let toastTimer = null;
function toast(message, type = "error") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast toast-${type}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON 响应 */ }
  if (!res.ok) {
    const message = body?.error || `请求失败（${res.status}）`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return body;
}

/* ---------------- 列表 ---------------- */

function sortClocks(arr) {
  return arr.slice().sort((a, b) => {
    // 超过约定复测时间的表置顶；滞留越久越靠前
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.overdue && b.overdue) {
      return new Date(a.scheduledRetestAt) - new Date(b.scheduledRetestAt);
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function visibleClocks() {
  const keyword = state.search.trim().toLowerCase();
  return sortClocks(state.clocks).filter((clock) => {
    if (state.filter === "overdue") {
      if (!clock.overdue) return false;
    } else if (state.filter !== "all" && clock.status !== state.filter) {
      return false;
    }
    if (keyword) {
      const haystack = `${clock.code} ${clock.escapementType} ${clock.note}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

function renderStats() {
  const count = (status) => state.clocks.filter((c) => c.status === status).length;
  const overdueCount = state.clocks.filter((c) => c.overdue).length;
  $("#stats").innerHTML = `
    <span class="stat-pill">共 <b>${state.clocks.length}</b> 只</span>
    <span class="stat-pill">待调校 <b>${count("NEEDS_ADJUSTMENT")}</b></span>
    <span class="stat-pill">待复测 <b>${count("AWAITING_RETEST")}</b></span>
    <span class="stat-pill">复测未达标 <b>${count("RETEST_FAILED")}</b></span>
    <span class="stat-pill">待交付 <b>${count("READY_FOR_DELIVERY")}</b></span>
    <span class="stat-pill" style="color:${overdueCount ? "var(--red)" : ""}">超约定 <b>${overdueCount}</b></span>
  `;
}

function actionForStatus(clock) {
  switch (clock.status) {
    case "NEEDS_ADJUSTMENT":
      return { label: "登记调校", cls: "btn-blue" };
    case "AWAITING_RETEST":
      return { label: "登记复测", cls: "btn-primary" };
    case "RETEST_FAILED":
      return { label: "重新调校", cls: "btn-danger" };
    case "READY_FOR_DELIVERY":
      return { label: "重新调校", cls: "btn-blue" };
    default:
      return { label: "操作", cls: "btn-blue" };
  }
}

function renderTable() {
  const rows = visibleClocks();
  const tbody = $("#clockTbody");
  $("#emptyState").hidden = rows.length !== 0;

  tbody.innerHTML = rows.map((clock) => {
    const meta = STATUS_META[clock.status];
    const action = actionForStatus(clock);
    const retest = clock.activeRetest;
    const retestCell = retest
      ? `<span class="rate ${retest.qualified ? "rate-ok" : "rate-bad"}">${signedRate(retest.dailyRateSeconds)}</span>
         <span class="cell-sub">${retest.qualified ? "达标" : "未达标"} · 摆幅 ${escapeHtml(retest.amplitude)}°</span>`
      : `<span class="muted">—</span>`;
    const stuck = clock.overdue && clock.scheduledRetestAt
      ? `<span class="stuck-tag stuck-duration" data-scheduled="${escapeHtml(clock.scheduledRetestAt)}">${stuckDuration(clock.scheduledRetestAt)}</span>`
      : "";
    return `
      <tr class="${clock.overdue ? "row-overdue" : ""}" data-id="${escapeHtml(clock.id)}">
        <td>
          <span class="badge ${meta.badge}"><span class="dot"></span>${meta.label}</span>
          ${stuck}
        </td>
        <td>
          <div class="cell-code">${escapeHtml(clock.code)}</div>
          <div class="cell-sub">建档 ${fmtDateTime(clock.createdAt)}</div>
        </td>
        <td>
          <div>${escapeHtml(clock.escapementType)}</div>
          <div class="cell-sub">${escapeHtml(clock.balanceFrequency)}</div>
        </td>
        <td>±${escapeHtml(clock.targetDailyRateSeconds)} 秒/天</td>
        <td>
          ${clock.latestAdjustment
            ? `<div>${escapeHtml(clock.latestAdjustment.direction)}</div>
               <div class="cell-sub">${fmtDateTime(clock.latestAdjustment.createdAt)}</div>`
            : `<span class="muted">尚未调校</span>`}
        </td>
        <td>
          ${clock.latestAdjustment && clock.scheduledRetestAt
            ? `<div style="${clock.overdue ? "color:var(--red);font-weight:600" : ""}">${fmtDateTime(clock.scheduledRetestAt)}</div>
               <div class="cell-sub">${clock.overdue ? "已超约定时间" : ""}</div>`
            : `<span class="muted">—</span>`}
        </td>
        <td>${retestCell}</td>
        <td class="col-actions">
          <button class="btn btn-sm ${action.cls}" data-act="quick" data-id="${escapeHtml(clock.id)}" type="button">${action.label}</button>
          <button class="btn btn-sm btn-ghost-dark" data-act="detail" data-id="${escapeHtml(clock.id)}" type="button">详情/历史</button>
        </td>
      </tr>
    `;
  }).join("");

  renderStats();
  updateStuckTags();
}

/* ---------------- 详情 / 历史 / 操作表单 ---------------- */

function renderAdjustmentForm(clock) {
  const failed = clock.status === "RETEST_FAILED";
  const invalidate = clock.status === "READY_FOR_DELIVERY";
  const defaultScheduled = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const lastRate = clock.latestRetest ? clock.latestRetest.dailyRateSeconds : "";
  return `
    <div class="sub-title">${failed ? "重新登记调校" : "登记调校"}</div>
    ${invalidate ? `<div class="action-note">注意：该表现处待交付，提交新调校后交付状态立即失效，需重新走复测闭环。</div>` : ""}
    <div class="action-card">
      <form id="adjustForm" data-clock-id="${escapeHtml(clock.id)}">
        <label>调校前日差(秒/天)
          <input name="currentDailyRateSeconds" type="number" step="1" required value="${lastRate}" placeholder="如 68，正为快、负为慢" />
        </label>
        <label>调校方向
          <select name="direction" required>
            <option value="慢针方向">慢针方向（调慢）</option>
            <option value="快针方向">快针方向（调快）</option>
          </select>
        </label>
        <label class="full">调校动作 / 幅度
          <input name="amount" required placeholder="如 游丝快慢针向慢侧微调0.4格" />
        </label>
        <label>约定复测时间
          <input name="scheduledRetestAt" type="datetime-local" required value="${toLocalInputValue(defaultScheduled)}" />
        </label>
        <label>备注
          <input name="note" placeholder="选填" />
        </label>
        <div class="actions">
          <button type="submit" class="btn ${invalidate ? "btn-danger" : "btn-primary"}">
            ${failed ? "提交重新调校" : invalidate ? "重新调校（交付失效）" : "提交调校"}
          </button>
        </div>
      </form>
    </div>
  `;
}

function renderRetestForm(clock) {
  const defaultTested = new Date().toISOString();
  return `
    <div class="sub-title">登记复测（仅可复测一次）</div>
    <div class="action-card">
      <form id="retestForm" data-clock-id="${escapeHtml(clock.id)}" data-target="${escapeHtml(clock.targetDailyRateSeconds)}">
        <label>实测日差(秒/天)
          <input name="dailyRateSeconds" type="number" step="1" required placeholder="如 12，正为快、负为慢" />
        </label>
        <label>摆幅(°)
          <input name="amplitude" type="number" step="1" required placeholder="如 252" />
        </label>
        <label>复测时间
          <input name="testedAt" type="datetime-local" required value="${toLocalInputValue(defaultTested)}" />
        </label>
        <label>备注
          <input name="note" placeholder="选填" />
        </label>
        <div class="qualified-hint" id="qualifiedHint">输入实测日差后自动判定，达标范围 ±${escapeHtml(clock.targetDailyRateSeconds)} 秒/天</div>
        <div class="actions">
          <button type="submit" class="btn btn-primary">提交复测</button>
        </div>
      </form>
    </div>
  `;
}

function buildTimeline(history) {
  const items = [
    ...history.adjustments.map((a) => ({
      kind: "adjust",
      time: a.createdAt,
      data: a
    })),
    ...history.retests.map((r) => ({
      kind: "retest",
      time: r.testedAt,
      data: r
    }))
  ].sort((a, b) => new Date(b.time) - new Date(a.time));

  if (!items.length) {
    return `<div class="locked-note">暂无调校 / 复测记录，先登记一次调校开始闭环。</div>`;
  }

  const adjMap = new Map(history.adjustments.map((a) => [a.id, a]));

  return `<ul class="timeline">${items.map((item) => {
    if (item.kind === "adjust") {
      const a = item.data;
      const retest = history.retests.find((r) => r.adjustmentId === a.id);
      return `
        <li class="tl-adjust">
          <div class="tl-card">
            <div class="tl-head">
              <strong>调校 · ${escapeHtml(a.direction)}</strong>
              <span class="tl-tag tl-tag-adj">调校</span>
            </div>
            <div class="tl-time">${fmtDateTime(a.createdAt)} ｜ 约定复测 ${fmtDateTime(a.scheduledRetestAt)}</div>
            <div class="tl-body">
              <p>调校前 ${signedRate(a.currentDailyRateSeconds)}</p>
              <p>${escapeHtml(a.amount)}</p>
              ${a.note ? `<p class="tl-note">备注：${escapeHtml(a.note)}</p>` : ""}
              <p class="tl-note">复测情况：${
                retest
                  ? `<span class="tl-tag ${retest.qualified ? "tl-tag-pass" : "tl-tag-fail"}">${retest.qualified ? "复测达标" : "复测未达标"}</span>`
                  : `<span class="tl-tag tl-tag-wait">待复测（不可重复登记）</span>`
              }</p>
            </div>
          </div>
        </li>`;
    }
    const r = item.data;
    const adj = adjMap.get(r.adjustmentId);
    return `
      <li class="tl-retest ${r.qualified ? "tl-ok" : ""}">
        <div class="tl-card">
          <div class="tl-head">
            <strong>复测 · ${signedRate(r.dailyRateSeconds)}</strong>
            <span class="tl-tag ${r.qualified ? "tl-tag-pass" : "tl-tag-fail"}">${r.qualified ? "达标 · 待交付" : "未达标 · 需重新调校"}</span>
          </div>
          <div class="tl-time">${fmtDateTime(r.testedAt)} ｜ 摆幅 ${escapeHtml(r.amplitude)}°</div>
          <div class="tl-body">
            ${adj ? `<p>对应调校：${escapeHtml(adj.amount)}</p>` : ""}
            ${r.note ? `<p class="tl-note">备注：${escapeHtml(r.note)}</p>` : ""}
          </div>
        </div>
      </li>`;
  }).join("")}</ul>`;
}

async function openDetail(clockId, mode = "detail") {
  let history;
  try {
    history = (await api(`/clocks/${encodeURIComponent(clockId)}/history`)).data;
  } catch (error) {
    toast(error.message);
    return;
  }
  state.selectedId = clockId;
  const clock = history.clock;
  const meta = STATUS_META[clock.status];
  $("#modalTitle").textContent = `${clock.code} · 详情与历史`;
  $("#modalSub").textContent = `${clock.escapementType} · ${clock.balanceFrequency} · 允许日差 ±${clock.targetDailyRateSeconds} 秒/天`;

  const stuck = clock.overdue && clock.scheduledRetestAt
    ? `<span class="stuck-tag stuck-duration" data-scheduled="${escapeHtml(clock.scheduledRetestAt)}">${stuckDuration(clock.scheduledRetestAt)}</span>`
    : "";

  let actionBlock;
  if (mode === "retest" || (mode !== "adjust" && clock.status === "AWAITING_RETEST")) {
    actionBlock = renderRetestForm(clock);
  } else if (["NEEDS_ADJUSTMENT", "RETEST_FAILED", "READY_FOR_DELIVERY"].includes(clock.status)) {
    actionBlock = renderAdjustmentForm(clock);
  } else {
    actionBlock = `
      <div class="locked-note">
        当前为「待复测」状态：每项调校只能复测一次。请提交本次调校的复测结果；
        复测未达标后才能重新登记调校。
      </div>`;
  }

  $("#modalContent").innerHTML = `
    <div class="status-banner ${meta.banner}">
      <b>当前状态：${meta.label} ${stuck}</b>
      ${meta.hint}
    </div>
    <div class="detail-meta">
      <div><span>编号</span>${escapeHtml(clock.code)}</div>
      <div><span>擒纵机构</span>${escapeHtml(clock.escapementType)}</div>
      <div><span>摆频</span>${escapeHtml(clock.balanceFrequency)}</div>
      <div><span>允许日差</span>±${escapeHtml(clock.targetDailyRateSeconds)} 秒/天</div>
      <div><span>建档时间</span>${fmtDateTime(clock.createdAt)}</div>
      <div><span>约定复测</span>${clock.scheduledRetestAt ? fmtDateTime(clock.scheduledRetestAt) : "—"}</div>
      <div style="grid-column: span 2;"><span>备注</span>${escapeHtml(clock.note || "—")}</div>
    </div>
    ${actionBlock}
    <div class="sub-title">调校 / 复测历史（按时间倒序）</div>
    ${buildTimeline(history)}
  `;

  $("#modal").hidden = false;
  bindActionForms(clock);
  updateStuckTags();
}

function bindActionForms(clock) {
  const adjustForm = $("#adjustForm");
  if (adjustForm) {
    adjustForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(adjustForm);
      const payload = {
        currentDailyRateSeconds: Number(fd.get("currentDailyRateSeconds")),
        direction: fd.get("direction"),
        amount: String(fd.get("amount")).trim(),
        scheduledRetestAt: new Date(String(fd.get("scheduledRetestAt"))).toISOString(),
        note: String(fd.get("note") || "").trim()
      };
      const btn = adjustForm.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await api(`/clocks/${clock.id}/adjustments`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        toast("调校已登记，状态：待复测", "success");
        await loadClocks();
        await openDetail(clock.id, "detail");
      } catch (error) {
        toast(error.message);
        btn.disabled = false;
      }
    });
  }

  const retestForm = $("#retestForm");
  if (retestForm) {
    const hint = $("#qualifiedHint");
    const rateInput = retestForm.querySelector("[name=dailyRateSeconds]");
    const target = Number(retestForm.dataset.target);
    rateInput.addEventListener("input", () => {
      const v = Number(rateInput.value);
      if (rateInput.value === "") {
        hint.textContent = `输入实测日差后自动判定，达标范围 ±${target} 秒/天`;
        hint.className = "qualified-hint";
        return;
      }
      const ok = Math.abs(v) <= target;
      hint.textContent = ok
        ? `日差 ${v} 秒/天，在 ±${target} 范围内 → 复测达标，将进入待交付`
        : `日差 ${v} 秒/天，超出 ±${target} 范围 → 复测未达标，须重新调校`;
      hint.className = `qualified-hint ${ok ? "is-ok" : "is-bad"}`;
    });

    retestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(retestForm);
      const payload = {
        dailyRateSeconds: Number(fd.get("dailyRateSeconds")),
        amplitude: Number(fd.get("amplitude")),
        testedAt: new Date(String(fd.get("testedAt"))).toISOString(),
        note: String(fd.get("note") || "").trim()
      };
      const btn = retestForm.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const result = await api(`/clocks/${clock.id}/retests`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        toast(result.data.qualified ? "复测达标，已进入待交付" : "复测未达标，请重新调校", "success");
        await loadClocks();
        await openDetail(clock.id, "detail");
      } catch (error) {
        toast(error.message);
        btn.disabled = false;
      }
    });
  }
}

function closeModal() {
  $("#modal").hidden = true;
  state.selectedId = null;
}

/* ---------------- 定时刷新 ---------------- */

function updateStuckTags() {
  const now = Date.now();
  $$(".stuck-duration").forEach((el) => {
    const text = stuckDuration(el.dataset.scheduled, now);
    if (text) {
      el.textContent = text;
      el.style.display = "";
    } else {
      el.style.display = "none";
    }
  });
  $("#clockNow").textContent = new Date().toLocaleString("zh-CN", { hour12: false });
}

async function loadClocks() {
  try {
    const result = await api("/clocks");
    state.clocks = result.data;
    renderTable();
  } catch (error) {
    toast(`状态同步失败：${error.message}`);
  }
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  $("#createForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const payload = {
      code: String(fd.get("code")).trim(),
      escapementType: String(fd.get("escapementType")).trim(),
      balanceFrequency: String(fd.get("balanceFrequency")).trim(),
      targetDailyRateSeconds: Number(fd.get("targetDailyRateSeconds")),
      note: String(fd.get("note") || "").trim()
    };
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const result = await api("/clocks", { method: "POST", body: JSON.stringify(payload) });
      toast(`已建档：${result.data.code}（待调校）`, "success");
      form.reset();
      form.querySelector("[name=targetDailyRateSeconds]").value = 30;
      state.filter = "all";
      $$("#filters .chip").forEach((c) => c.classList.toggle("is-active", c.dataset.filter === "all"));
      await loadClocks();
      await openDetail(result.data.id, "adjust");
    } catch (error) {
      toast(error.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("#filters").addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    state.filter = chip.dataset.filter;
    $$("#filters .chip").forEach((c) => c.classList.toggle("is-active", c === chip));
    renderTable();
  });

  $("#searchInput").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderTable();
  });

  $("#clockTbody").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-act]");
    if (btn) {
      event.stopPropagation();
      const id = btn.dataset.id;
      const clock = state.clocks.find((c) => c.id === id);
      if (btn.dataset.act === "quick") {
        const mode = clock.status === "AWAITING_RETEST" ? "retest" : "adjust";
        openDetail(id, mode);
      } else {
        openDetail(id, "detail");
      }
      return;
    }
    const row = event.target.closest("tr[data-id]");
    if (row) openDetail(row.dataset.id, "detail");
  });

  $("#modal").addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#modal").hidden) closeModal();
  });

  $("#refreshBtn").addEventListener("click", async () => {
    await loadClocks();
    if (state.selectedId) await openDetail(state.selectedId, "detail");
    toast("状态已刷新", "success");
  });
}

bindEvents();
loadClocks();
// 每 30 秒同步后端状态并刷新滞留时长（与手动刷新看到的状态一致）
setInterval(loadClocks, 30000);
setInterval(updateStuckTags, 1000);
updateStuckTags();
