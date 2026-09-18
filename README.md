# 机械钟表擒纵调校作业台

零依赖 Node 服务 + 原生前端页面，使用 `data/db.json` 持久化钟表档案、调校记录和复测记录。
打开页面即可建档、登记调校、复测、筛选和查看历史。

## 启动

```bash
PORT=3021 node server.js
# 浏览器打开 http://127.0.0.1:3021
```

## 状态机（由原始记录实时推导，不另存状态字段）

每只钟表的状态只根据 `adjustments` / `retests` 原始记录推导，因此列表、详情、历史与刷新后的状态永远一致：

| 状态 | 含义 | 下一动作 |
| --- | --- | --- |
| 待调校 NEEDS_ADJUSTMENT | 尚未调校，或复测未达标后等待重新调校 | 登记调校 |
| 待复测 AWAITING_RETEST | 最新一项调校尚无复测记录（进行中） | 登记复测（一次） |
| 复测未达标 RETEST_FAILED | 最新调校的复测不合格 | 必须先重新调校 |
| 待交付 READY_FOR_DELIVERY | 复测达标 | 重新调校会立即使交付失效 |

## 业务规则（服务端强制，违反返回 409）

1. **每只表只能有一项进行中调校**：最新调校尚无复测记录时，禁止再登记调校。
2. **每项调校只能复测一次**：复测未达标必须先重新调校，不能重复复测；达标后同样不能再复测该项。
3. **达标进入待交付，重新调校立即让交付失效**：待交付状态下登记新调校，立即回到待复测，需重新走完复测闭环。

登记调校时需填写**约定复测时间**（默认 24 小时后）。处于待复测且已超过约定时间的钟表：

- 在列表中自动**置顶**（滞留越久越靠前），红色标识并显示**滞留时长**（按秒刷新）；
- 可通过「⏳ 超约定时间」筛选，也可用 `GET /clocks?overdue=true` 查询；
- 每 30 秒自动同步后端状态，手动「刷新状态」或刷新页面结果一致。

## 页面功能

- 新建钟表档案（编号去重，大小写不敏感）
- 在台钟表列表：状态徽章、最近调校/复测、约定复测时间、滞留标识
- 状态筛选（四种状态 + 超约定时间）与关键字搜索
- 详情抽屉：当前状态说明、登记调校 / 复测表单（日差自动预判是否达标）、完整调校-复测历史时间线
- 顶部统计各状态数量

## 主要接口

- `GET /` 前端作业台
- `GET /health`
- `GET /clocks`（支持 `qualified=true|false`、`overdue=true`）
- `POST /clocks`
- `GET /clocks/not-qualified`
- `GET /clocks/:id/history`（含推导出的统一 `status` / `overdue`）
- `POST /clocks/:id/adjustments`（字段含 `scheduledRetestAt`，默认 +24h）
- `POST /clocks/:id/retests`
- `GET /clocks/:id/latest-retest`
- `GET /adjustments?clockId=`
- `GET /retests?clockId=&qualified=`

## 闭环示例

```bash
curl -X POST http://127.0.0.1:3021/clocks/clock_demo/adjustments \
  -H 'Content-Type: application/json' \
  -d '{"currentDailyRateSeconds":31,"direction":"慢针方向","amount":"快慢针再向慢侧0.2格","scheduledRetestAt":"2026-09-19T06:00:00Z"}'

curl -X POST http://127.0.0.1:3021/clocks/clock_demo/retests \
  -H 'Content-Type: application/json' \
  -d '{"dailyRateSeconds":12,"amplitude":252,"note":"复测进入目标范围"}'
```
