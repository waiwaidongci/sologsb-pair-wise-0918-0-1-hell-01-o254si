const http = require("http");
const { readFile, writeFile, mkdir } = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 3021);
const DB_FILE = path.join(__dirname, "data", "db.json");
const INDEX_FILE = path.join(__dirname, "public", "index.html");

const initialData = {
  clocks: [
    {
      id: "clock_demo",
      code: "CLK-1890-07",
      escapementType: "瑞士杠杆式",
      balanceFrequency: "18000vph",
      targetDailyRateSeconds: 20,
      note: "怀表机芯，走时偏快",
      createdAt: new Date().toISOString()
    }
  ],
  adjustments: [
    {
      id: "adjustment_demo",
      clockId: "clock_demo",
      currentDailyRateSeconds: 68,
      direction: "慢针方向",
      amount: "游丝快慢针向慢侧微调0.4格",
      dueAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      note: "初次调校，先保守处理",
      createdAt: new Date().toISOString()
    }
  ],
  retests: [
    {
      id: "retest_demo",
      clockId: "clock_demo",
      adjustmentId: "adjustment_demo",
      testedAt: new Date().toISOString(),
      dailyRateSeconds: 31,
      amplitude: 248,
      qualified: false,
      note: "仍偏快，振幅尚可"
    }
  ]
};

const routes = [
  "GET /",
  "GET /health",
  "GET /clocks",
  "POST /clocks",
  "GET /clocks/not-qualified",
  "GET /clocks/:id",
  "GET /clocks/:id/history",
  "POST /clocks/:id/adjustments",
  "POST /clocks/:id/retests",
  "POST /clocks/:id/deliver",
  "GET /clocks/:id/latest-retest",
  "GET /adjustments",
  "GET /retests"
];

async function ensureDb() {
  await mkdir(path.dirname(DB_FILE), { recursive: true });
  try {
    JSON.parse(await readFile(DB_FILE, "utf8"));
  } catch {
    await writeDb(initialData);
  }
}

async function readDb() {
  await ensureDb();
  const db = JSON.parse(await readFile(DB_FILE, "utf8"));
  db.clocks ||= [];
  db.adjustments ||= [];
  db.retests ||= [];
  return db;
}

async function writeDb(data) {
  await writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function parseBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求体必须是合法JSON");
    error.status = 400;
    throw error;
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function required(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === "");
  if (missing.length) {
    const error = new Error(`缺少字段：${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  throw error;
}

function findClock(db, clockId) {
  const clock = db.clocks.find((item) => item.id === clockId);
  if (!clock) {
    const error = new Error("钟表不存在");
    error.status = 404;
    throw error;
  }
  return clock;
}

function latestRetest(db, clockId) {
  return db.retests
    .filter((item) => item.clockId === clockId)
    .sort((a, b) => new Date(b.testedAt) - new Date(a.testedAt))[0] || null;
}

function latestAdjustment(db, clockId) {
  return db.adjustments
    .filter((item) => item.clockId === clockId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

function retestOfAdjustment(db, adjustmentId) {
  return db.retests.find((item) => item.adjustmentId === adjustmentId) || null;
}

// 进行中的调校 = 尚未复测的调校（每项调校只能复测一次，复测后即关闭）
function openAdjustment(db, clockId) {
  return db.adjustments
    .filter((item) => item.clockId === clockId && !retestOfAdjustment(db, item.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

// 状态机全部由调校/复测记录推导，列表、详情、历史共用同一份结果
function clockSummary(db, clock) {
  const adjustment = latestAdjustment(db, clock.id);
  const open = openAdjustment(db, clock.id);
  const retest = latestRetest(db, clock.id);
  let status = "idle";
  if (open) {
    status = "adjusting";
  } else if (adjustment) {
    const closedRetest = retestOfAdjustment(db, adjustment.id);
    if (closedRetest && closedRetest.qualified) {
      status = clock.deliveredAt ? "delivered" : "pending_delivery";
    } else {
      status = "needs_adjustment";
    }
  }
  const dueAt = open && open.dueAt ? open.dueAt : null;
  const overdueSeconds = dueAt ? Math.max(0, Math.floor((Date.now() - new Date(dueAt).getTime()) / 1000)) : 0;
  return {
    ...clock,
    status,
    openAdjustment: open,
    latestAdjustment: adjustment,
    latestRetest: retest,
    dueAt,
    overdue: overdueSeconds > 0,
    overdueSeconds,
    qualified: retest ? retest.qualified : false
  };
}

// 超过约定复测时间的表置顶，滞留越久越靠前
function compareClocks(a, b) {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.overdue && b.overdue) return b.overdueSeconds - a.overdueSeconds;
  return new Date(b.createdAt) - new Date(a.createdAt);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    const html = await readFile(INDEX_FILE, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  const db = await readDb();

  if (req.method === "GET" && pathname === "/health") {
    return send(res, 200, { ok: true, service: "clock-escapement-tuning-api", routes });
  }

  if (req.method === "GET" && pathname === "/clocks") {
    const qualified = url.searchParams.get("qualified");
    const status = url.searchParams.get("status");
    let data = db.clocks.map((clock) => clockSummary(db, clock));
    if (status) data = data.filter((clock) => clock.status === status);
    if (qualified !== null) {
      const expected = qualified === "true";
      data = data.filter((clock) => clock.qualified === expected);
    }
    data.sort(compareClocks);
    return send(res, 200, { data });
  }

  if (req.method === "POST" && pathname === "/clocks") {
    const body = await parseBody(req);
    required(body, ["code", "escapementType", "balanceFrequency"]);
    const clock = {
      id: makeId("clock"),
      code: body.code,
      escapementType: body.escapementType,
      balanceFrequency: body.balanceFrequency,
      targetDailyRateSeconds: Number(body.targetDailyRateSeconds ?? 30),
      note: body.note || "",
      createdAt: new Date().toISOString()
    };
    db.clocks.push(clock);
    await writeDb(db);
    return send(res, 201, { data: clockSummary(db, clock) });
  }

  if (req.method === "GET" && pathname === "/clocks/not-qualified") {
    const data = db.clocks
      .map((clock) => clockSummary(db, clock))
      .filter((clock) => !clock.qualified)
      .sort(compareClocks);
    return send(res, 200, { data });
  }

  const clockMatch = pathname.match(/^\/clocks\/([^/]+)$/);
  if (clockMatch && req.method === "GET") {
    const clock = findClock(db, clockMatch[1]);
    return send(res, 200, { data: clockSummary(db, clock) });
  }

  const historyMatch = pathname.match(/^\/clocks\/([^/]+)\/history$/);
  if (historyMatch && req.method === "GET") {
    const clock = findClock(db, historyMatch[1]);
    const adjustments = db.adjustments
      .filter((item) => item.clockId === clock.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((item) => ({ ...item, retest: retestOfAdjustment(db, item.id) }));
    const retests = db.retests
      .filter((item) => item.clockId === clock.id)
      .sort((a, b) => new Date(b.testedAt) - new Date(a.testedAt));
    return send(res, 200, {
      data: { clock: clockSummary(db, clock), adjustments, retests, latestRetest: latestRetest(db, clock.id) }
    });
  }

  const adjustmentMatch = pathname.match(/^\/clocks\/([^/]+)\/adjustments$/);
  if (adjustmentMatch && req.method === "POST") {
    const clock = findClock(db, adjustmentMatch[1]);
    const body = await parseBody(req);
    required(body, ["currentDailyRateSeconds", "direction", "amount", "dueAt"]);
    if (openAdjustment(db, clock.id)) {
      conflict("每只表只能有一项进行中调校，请先完成复测");
    }
    const dueAt = new Date(body.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      const error = new Error("约定复测时间 dueAt 格式不正确");
      error.status = 400;
      throw error;
    }
    const adjustment = {
      id: makeId("adjustment"),
      clockId: clock.id,
      currentDailyRateSeconds: Number(body.currentDailyRateSeconds),
      direction: body.direction,
      amount: body.amount,
      dueAt: dueAt.toISOString(),
      note: body.note || "",
      createdAt: new Date().toISOString()
    };
    db.adjustments.push(adjustment);
    // 重新调校立即让交付失效
    if (clock.deliveredAt) delete clock.deliveredAt;
    await writeDb(db);
    return send(res, 201, { data: adjustment, clock: clockSummary(db, clock) });
  }

  const retestMatch = pathname.match(/^\/clocks\/([^/]+)\/retests$/);
  if (retestMatch && req.method === "POST") {
    const clock = findClock(db, retestMatch[1]);
    const body = await parseBody(req);
    required(body, ["dailyRateSeconds", "amplitude"]);
    const open = openAdjustment(db, clock.id);
    if (!open) {
      conflict("当前没有进行中的调校：复测未达标必须先重新调校");
    }
    if (body.adjustmentId && body.adjustmentId !== open.id) {
      conflict("该项调校已完成复测，每项调校只能复测一次");
    }
    const qualified = body.qualified !== undefined
      ? Boolean(body.qualified)
      : Math.abs(Number(body.dailyRateSeconds)) <= Number(clock.targetDailyRateSeconds);
    const retest = {
      id: makeId("retest"),
      clockId: clock.id,
      adjustmentId: open.id,
      testedAt: body.testedAt || new Date().toISOString(),
      dailyRateSeconds: Number(body.dailyRateSeconds),
      amplitude: Number(body.amplitude),
      qualified,
      note: body.note || ""
    };
    db.retests.push(retest);
    await writeDb(db);
    return send(res, 201, { data: retest, clock: clockSummary(db, clock) });
  }

  const deliverMatch = pathname.match(/^\/clocks\/([^/]+)\/deliver$/);
  if (deliverMatch && req.method === "POST") {
    const clock = findClock(db, deliverMatch[1]);
    if (clockSummary(db, clock).status !== "pending_delivery") {
      conflict("仅复测达标、待交付的钟表才能交付");
    }
    clock.deliveredAt = new Date().toISOString();
    await writeDb(db);
    return send(res, 200, { data: clockSummary(db, clock) });
  }

  const latestMatch = pathname.match(/^\/clocks\/([^/]+)\/latest-retest$/);
  if (latestMatch && req.method === "GET") {
    findClock(db, latestMatch[1]);
    return send(res, 200, { data: latestRetest(db, latestMatch[1]) });
  }

  if (req.method === "GET" && pathname === "/adjustments") {
    const clockId = url.searchParams.get("clockId");
    return send(res, 200, { data: db.adjustments.filter((item) => !clockId || item.clockId === clockId) });
  }

  if (req.method === "GET" && pathname === "/retests") {
    const clockId = url.searchParams.get("clockId");
    const qualified = url.searchParams.get("qualified");
    const data = db.retests.filter((item) => {
      const matchClock = !clockId || item.clockId === clockId;
      const matchQualified = qualified === null || item.qualified === (qualified === "true");
      return matchClock && matchQualified;
    });
    return send(res, 200, { data });
  }

  return send(res, 404, { error: "接口不存在", routes });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => send(res, error.status || 500, { error: error.message || "服务器错误" }));
});

server.listen(PORT, () => {
  console.log(`Clock escapement tuning API running at http://127.0.0.1:${PORT}`);
});
