const http = require("http");
const { readFile, writeFile, mkdir } = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 3021);
const DB_FILE = path.join(__dirname, "data", "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const initialData = {
  clocks: [
    {
      id: "clock_demo",
      code: "CLK-1890-07",
      escapementType: "瑞士杠杆式",
      balanceFrequency: "18000vph",
      targetDailyRateSeconds: 20,
      note: "怀表机芯，走时偏快",
      createdAt: "2026-06-16T00:00:00.000Z"
    },
    {
      id: "clock_marine_02",
      code: "CLK-1780-03",
      escapementType: "锚式擒纵",
      balanceFrequency: "14400vph",
      targetDailyRateSeconds: 40,
      note: "航海天文钟，走时偏快，已过约定复测时间",
      createdAt: "2026-09-15T08:00:00.000Z"
    },
    {
      id: "clock_wrist_22",
      code: "CLK-1905-22",
      escapementType: "瑞士杠杆式",
      balanceFrequency: "21600vph",
      targetDailyRateSeconds: 15,
      note: "腕表机芯，首轮复测未达标后再次调校",
      createdAt: "2026-09-14T09:30:00.000Z"
    },
    {
      id: "clock_coax_14",
      code: "CLK-1960-14",
      escapementType: "同轴擒纵",
      balanceFrequency: "28800vph",
      targetDailyRateSeconds: 10,
      note: "复测达标，等待交付客户",
      createdAt: "2026-09-11T02:10:00.000Z"
    },
    {
      id: "clock_cyl_09",
      code: "CLK-2001-09",
      escapementType: "圆柱式擒纵",
      balanceFrequency: "18000vph",
      targetDailyRateSeconds: 25,
      note: "新收工字轮怀表，尚未调校",
      createdAt: "2026-09-18T01:20:00.000Z"
    },
    {
      id: "clock_pin_31",
      code: "CLK-1888-31",
      escapementType: "销式擒纵",
      balanceFrequency: "21600vph",
      targetDailyRateSeconds: 30,
      note: "黑森林小钟，约定明日复测",
      createdAt: "2026-09-18T03:00:00.000Z"
    }
  ],
  adjustments: [
    {
      id: "adjustment_demo",
      clockId: "clock_demo",
      currentDailyRateSeconds: 68,
      direction: "慢针方向",
      amount: "游丝快慢针向慢侧微调0.4格",
      note: "初次调校，先保守处理",
      scheduledRetestAt: "2026-06-17T00:00:00.000Z",
      createdAt: "2026-06-16T00:00:00.000Z"
    },
    {
      id: "adjustment_marine_02_1",
      clockId: "clock_marine_02",
      currentDailyRateSeconds: 92,
      direction: "慢针方向",
      amount: "砝码螺钉向外微调1/4圈，降低摆轮惯性补偿",
      note: "偏快较多，先粗调一档",
      scheduledRetestAt: "2026-09-17T02:00:00.000Z",
      createdAt: "2026-09-16T02:00:00.000Z"
    },
    {
      id: "adjustment_wrist_22_1",
      clockId: "clock_wrist_22",
      currentDailyRateSeconds: 44,
      direction: "慢针方向",
      amount: "快慢针向慢侧移动0.2格",
      note: "首轮保守调校",
      scheduledRetestAt: "2026-09-15T12:00:00.000Z",
      createdAt: "2026-09-15T09:00:00.000Z"
    },
    {
      id: "adjustment_wrist_22_2",
      clockId: "clock_wrist_22",
      currentDailyRateSeconds: 22,
      direction: "慢针方向",
      amount: "活动外桩环向慢侧再微调0.1格",
      note: "首轮复测仍偏快，二次精修",
      scheduledRetestAt: "2026-09-18T02:00:00.000Z",
      createdAt: "2026-09-17T10:00:00.000Z"
    },
    {
      id: "adjustment_coax_14_1",
      clockId: "clock_coax_14",
      currentDailyRateSeconds: 26,
      direction: "慢针方向",
      amount: "无卡度配重螺钉向外侧微调一档",
      note: "同轴机芯精调",
      scheduledRetestAt: "2026-09-13T02:00:00.000Z",
      createdAt: "2026-09-12T02:00:00.000Z"
    },
    {
      id: "adjustment_pin_31_1",
      clockId: "clock_pin_31",
      currentDailyRateSeconds: -47,
      direction: "快针方向",
      amount: "擒纵销微调螺母向快侧旋半圈",
      note: "走时偏慢，约定24小时后复测",
      scheduledRetestAt: "2026-09-19T03:00:00.000Z",
      createdAt: "2026-09-18T03:00:00.000Z"
    }
  ],
  retests: [
    {
      id: "retest_demo",
      clockId: "clock_demo",
      adjustmentId: "adjustment_demo",
      testedAt: "2026-06-16T00:00:00.000Z",
      dailyRateSeconds: 31,
      amplitude: 248,
      qualified: false,
      note: "仍偏快，振幅尚可"
    },
    {
      id: "retest_wrist_22_1",
      clockId: "clock_wrist_22",
      adjustmentId: "adjustment_wrist_22_1",
      testedAt: "2026-09-15T15:00:00.000Z",
      dailyRateSeconds: 22,
      amplitude: 268,
      qualified: false,
      note: "超出±15秒目标，需重新调校"
    },
    {
      id: "retest_coax_14_1",
      clockId: "clock_coax_14",
      adjustmentId: "adjustment_coax_14_1",
      testedAt: "2026-09-13T03:20:00.000Z",
      dailyRateSeconds: 8,
      amplitude: 302,
      qualified: true,
      note: "日差与摆幅均进入目标范围，待交付"
    }
  ]
};

const routes = [
  "GET /",
  "GET /health",
  "GET /clocks",
  "POST /clocks",
  "GET /clocks/not-qualified",
  "GET /clocks/:id/history",
  "POST /clocks/:id/adjustments",
  "POST /clocks/:id/retests",
  "GET /clocks/:id/latest-retest",
  "GET /adjustments?clockId=",
  "GET /retests?clockId=&qualified="
];

// 状态机：所有状态均由 adjustments / retests 原始记录实时推导，
// 列表、详情、历史与刷新后看到的状态永远一致。
// NEEDS_ADJUSTMENT 待调校 -> AWAITING_RETEST 待复测
//   -> READY_FOR_DELIVERY 待交付（复测达标）
//   -> RETEST_FAILED 复测未达标（必须先重新调校）
// 待交付状态下重新调校，立即回到待复测，交付失效。
const STATUS = {
  NEEDS_ADJUSTMENT: "NEEDS_ADJUSTMENT",
  AWAITING_RETEST: "AWAITING_RETEST",
  RETEST_FAILED: "RETEST_FAILED",
  READY_FOR_DELIVERY: "READY_FOR_DELIVERY"
};

async function ensureDb() {
  await mkdir(path.dirname(DB_FILE), { recursive: true });
  try {
    JSON.parse(await readFile(DB_FILE, "utf8"));
  } catch {
    await writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await readFile(DB_FILE, "utf8"));
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

// 由原始记录推导单只钟表的完整状态（唯一事实来源）
function clockSummary(db, clock) {
  const adjustments = db.adjustments
    .filter((item) => item.clockId === clock.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const retests = db.retests.filter((item) => item.clockId === clock.id);
  const latestAdjustment = adjustments[adjustments.length - 1] || null;
  const latestRetest =
    retests.slice().sort((a, b) => new Date(b.testedAt) - new Date(a.testedAt))[0] || null;
  const activeRetest = latestAdjustment
    ? retests.find((item) => item.adjustmentId === latestAdjustment.id) || null
    : null;

  let status;
  if (!latestAdjustment) {
    status = STATUS.NEEDS_ADJUSTMENT;
  } else if (!activeRetest) {
    status = STATUS.AWAITING_RETEST;
  } else if (activeRetest.qualified) {
    status = STATUS.READY_FOR_DELIVERY;
  } else {
    status = STATUS.RETEST_FAILED;
  }

  const scheduledRetestAt = latestAdjustment?.scheduledRetestAt || null;
  const overdue =
    status === STATUS.AWAITING_RETEST &&
    scheduledRetestAt != null &&
    Date.now() > new Date(scheduledRetestAt).getTime();

  return {
    ...clock,
    status,
    latestAdjustment,
    latestRetest,
    activeRetest,
    scheduledRetestAt,
    overdue,
    qualified: status === STATUS.READY_FOR_DELIVERY
  };
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

async function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, decodeURIComponent(rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, { error: "禁止访问" });
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    send(res, 404, { error: "文件不存在" });
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    return serveStatic(req, res, "/index.html");
  }
  if (req.method === "GET" && /^\/(styles\.css|app\.js|favicon\.ico)$/.test(pathname)) {
    return serveStatic(req, res, pathname);
  }

  const db = await readDb();

  if (req.method === "GET" && pathname === "/health") {
    return send(res, 200, { ok: true, service: "clock-escapement-workbench", routes });
  }

  if (req.method === "GET" && pathname === "/clocks") {
    const qualified = url.searchParams.get("qualified");
    const overdueOnly = url.searchParams.get("overdue") === "true";
    let data = db.clocks.map((clock) => clockSummary(db, clock));
    if (qualified !== null) {
      const expected = qualified === "true";
      data = data.filter((clock) => clock.qualified === expected);
    }
    if (overdueOnly) data = data.filter((clock) => clock.overdue);
    return send(res, 200, { data });
  }

  if (req.method === "POST" && pathname === "/clocks") {
    const body = await parseBody(req);
    required(body, ["code", "escapementType", "balanceFrequency"]);
    const code = String(body.code).trim();
    if (db.clocks.some((item) => item.code.toLowerCase() === code.toLowerCase())) {
      throw conflict(`钟表编号 ${code} 已存在，请勿重复建档`);
    }
    const clock = {
      id: makeId("clock"),
      code,
      escapementType: String(body.escapementType).trim(),
      balanceFrequency: String(body.balanceFrequency).trim(),
      targetDailyRateSeconds: Number(body.targetDailyRateSeconds ?? 30),
      note: body.note || "",
      createdAt: new Date().toISOString()
    };
    db.clocks.push(clock);
    await writeDb(db);
    return send(res, 201, { data: clockSummary(db, clock) });
  }

  if (req.method === "GET" && pathname === "/clocks/not-qualified") {
    const data = db.clocks.map((clock) => clockSummary(db, clock)).filter((clock) => !clock.qualified);
    return send(res, 200, { data });
  }

  const historyMatch = pathname.match(/^\/clocks\/([^/]+)\/history$/);
  if (historyMatch && req.method === "GET") {
    const clock = findClock(db, historyMatch[1]);
    const summary = clockSummary(db, clock);
    const adjustments = db.adjustments
      .filter((item) => item.clockId === clock.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const retests = db.retests
      .filter((item) => item.clockId === clock.id)
      .sort((a, b) => new Date(b.testedAt) - new Date(a.testedAt));
    return send(res, 200, {
      data: { clock: summary, adjustments, retests, status: summary.status, overdue: summary.overdue }
    });
  }

  const adjustmentMatch = pathname.match(/^\/clocks\/([^/]+)\/adjustments$/);
  if (adjustmentMatch && req.method === "POST") {
    const clock = findClock(db, adjustmentMatch[1]);
    const body = await parseBody(req);
    required(body, ["currentDailyRateSeconds", "direction", "amount"]);

    // 规则一：每只表只能有一项进行中调校（最新一次调校尚无复测记录即为进行中）
    const latest = latestAdjustment(db, clock.id);
    if (latest && !db.retests.some((item) => item.adjustmentId === latest.id)) {
      throw conflict("该钟表已有一项进行中的调校，请先完成复测后再登记新的调校");
    }

    let scheduledRetestAt;
    if (body.scheduledRetestAt) {
      const scheduled = new Date(body.scheduledRetestAt);
      if (Number.isNaN(scheduled.getTime())) {
        const error = new Error("约定复测时间格式不正确");
        error.status = 400;
        throw error;
      }
      scheduledRetestAt = scheduled.toISOString();
    } else {
      scheduledRetestAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }

    const adjustment = {
      id: makeId("adjustment"),
      clockId: clock.id,
      currentDailyRateSeconds: Number(body.currentDailyRateSeconds),
      direction: String(body.direction).trim(),
      amount: String(body.amount).trim(),
      note: body.note || "",
      scheduledRetestAt,
      createdAt: new Date().toISOString()
    };
    db.adjustments.push(adjustment);
    await writeDb(db);
    return send(res, 201, { data: adjustment, clock: clockSummary(db, clock) });
  }

  const retestMatch = pathname.match(/^\/clocks\/([^/]+)\/retests$/);
  if (retestMatch && req.method === "POST") {
    const clock = findClock(db, retestMatch[1]);
    const body = await parseBody(req);
    required(body, ["dailyRateSeconds", "amplitude"]);

    const latest = latestAdjustment(db, clock.id);
    if (!latest) {
      throw conflict("尚未登记调校，请先登记调校后再复测");
    }
    const adjustmentId = body.adjustmentId || latest.id;
    const target = db.adjustments.find((item) => item.id === adjustmentId && item.clockId === clock.id);
    if (!target) {
      const error = new Error("关联的调校记录不存在");
      error.status = 400;
      throw error;
    }
    // 规则二：每项调校只能复测一次；未达标必须先重新调校
    const previous = db.retests.find((item) => item.adjustmentId === target.id);
    if (previous) {
      throw conflict(
        previous.qualified
          ? "该项调校已复测合格，当前为待交付状态；重新调校会使交付状态失效"
          : "该项调校复测未达标，请先重新调校后再复测"
      );
    }

    const qualified = body.qualified !== undefined
      ? Boolean(body.qualified)
      : Math.abs(Number(body.dailyRateSeconds)) <= Number(clock.targetDailyRateSeconds);
    const retest = {
      id: makeId("retest"),
      clockId: clock.id,
      adjustmentId: target.id,
      testedAt: body.testedAt ? new Date(body.testedAt).toISOString() : new Date().toISOString(),
      dailyRateSeconds: Number(body.dailyRateSeconds),
      amplitude: Number(body.amplitude),
      qualified,
      note: body.note || ""
    };
    db.retests.push(retest);
    await writeDb(db);
    return send(res, 201, { data: retest, clock: clockSummary(db, clock) });
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

  if (req.method === "GET") return serveStatic(req, res, pathname);
  return send(res, 404, { error: "接口不存在", routes });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => send(res, error.status || 500, { error: error.message || "服务器错误" }));
});

server.listen(PORT, () => {
  console.log(`Clock escapement workbench running at http://127.0.0.1:${PORT}`);
});
