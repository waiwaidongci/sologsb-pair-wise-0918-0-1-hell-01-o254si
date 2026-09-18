# 机械钟表擒纵调校作业台

零依赖 Node 服务：`server.js` 同时提供 JSON API 与单页作业台（`public/index.html`），钟表档案、调校记录、复测记录持久化在 `data/db.json`。

## 启动

```bash
PORT=3021 node server.js
# 打开 http://127.0.0.1:3021/ 即可建档、登记调校、复测、筛选、查看历史
```

## 业务规则

- 每只表只能有一项**进行中调校**（尚未复测的调校）
- 每项调校**只能复测一次**，复测后该调校即关闭
- 复测未达标必须先**重新调校**，才能再次复测
- 复测达标进入**待交付**；重新调校立即让交付失效（含已交付记录）
- 超过**约定复测时间**的表在列表置顶，并显示滞留时长（逾期越久越靠前）
- 状态全部由调校/复测记录推导，列表、详情、历史与刷新后的状态保持一致

## 状态机

```
idle 待调校 ──登记调校──▶ adjusting 调校中 ──复测达标──▶ pending_delivery 待交付 ──交付──▶ delivered 已交付
                              │                                                        ▲
                              └──复测未达标──▶ needs_adjustment 待重新调校 ──登记调校───┘
```

## 主要接口

- `GET /` 作业台页面
- `GET /health`
- `GET /clocks?status=&qualified=` 列表（逾期置顶，含派生状态）
- `POST /clocks` 建档
- `GET /clocks/not-qualified`
- `GET /clocks/:id` 单表状态
- `GET /clocks/:id/history` 调校+复测历史
- `POST /clocks/:id/adjustments` 登记调校（需 `currentDailyRateSeconds/direction/amount/dueAt`，有进行中调校时 409）
- `POST /clocks/:id/retests` 复测（无进行中调校或该项已复测时 409）
- `POST /clocks/:id/deliver` 交付（仅待交付状态可用）
- `GET /clocks/:id/latest-retest`
- `GET /adjustments?clockId=`
- `GET /retests?clockId=&qualified=`

## 闭环示例

```bash
curl http://127.0.0.1:3021/clocks/not-qualified
# 复测未达标 → 先重新调校
curl -X POST http://127.0.0.1:3021/clocks/clock_demo/adjustments \
  -H 'Content-Type: application/json' \
  -d '{"currentDailyRateSeconds":31,"direction":"慢针方向","amount":"快慢针再调0.2格","dueAt":"2026-09-19T10:00:00.000Z"}'
# 再复测
curl -X POST http://127.0.0.1:3021/clocks/clock_demo/retests \
  -H 'Content-Type: application/json' \
  -d '{"dailyRateSeconds":12,"amplitude":252,"note":"复测进入目标范围"}'
# 达标后交付
curl -X POST http://127.0.0.1:3021/clocks/clock_demo/deliver
```
