---
name: monitor-position-risk
description: |
  持仓风险实时监控守护进程。持续监控投资组合的风险指标，
  包括单票集中度、行业偏离、VaR 突破、最大回撤预警等，
  当风险指标触及阈值时自动告警。
version: 1.0.0
license: Apache-2.0
metadata:
  clawx-finance:
    layer: monitor
    markets: [cn-a, hk]
    assets: [equity, bond]
    roles: [risk, pm]
    run_mode: daemon
    timeout: 0
    requires:
      skills:
        - data-wind-equity
        - indicator-risk-metrics
      env: []
      bins: [python3]
      mcp: [wind]
    tested_on:
      data_range: "2025-01-01/2026-02-27"
      markets_tested: [cn-a]
    reviewed_by: "风控团队"
    review_date: "2026-02-27"
    locale: zh-CN
    display_name_zh: "持仓风险监控"
    display_name_en: "Position Risk Monitor"
---

# 持仓风险监控 (Position Risk Monitor)

## 何时触发

- **自动触发**：以 daemon 模式运行，交易时段每 60 秒检查一次
- **手动触发**：用户要求检查持仓风险、风控报告

触发关键词：风控, 风险监控, 持仓检查, VaR, 集中度, 风险预警。

## 监控规则

### 1. 单票集中度

| 规则 | 阈值 | 级别 |
|------|------|------|
| 单票市值占比 > 10% | 预警 | WARNING |
| 单票市值占比 > 15% | 告警 | ALERT |
| 前5大持仓占比 > 50% | 预警 | WARNING |
| 前10大持仓占比 > 70% | 告警 | ALERT |

### 2. 行业偏离

基于申万一级行业分类，相对基准（沪深300）的偏离度：

| 规则 | 阈值 | 级别 |
|------|------|------|
| 单行业超配 > 10% | 预警 | WARNING |
| 单行业超配 > 15% | 告警 | ALERT |
| 前3大行业合计超配 > 25% | 告警 | ALERT |

### 3. VaR 监控

使用历史模拟法，252 日窗口：

| 规则 | 阈值 | 级别 |
|------|------|------|
| 日 VaR(95%) 突破预算 | 告警 | ALERT |
| 日 VaR(99%) 突破预算 | 紧急 | CRITICAL |
| 日 CVaR(95%) 突破预算 × 1.5 | 紧急 | CRITICAL |

默认 VaR 预算：组合净值的 2%（日 95%）。

### 4. 回撤监控

| 规则 | 阈值 | 级别 |
|------|------|------|
| 近5日回撤 > 3% | 预警 | WARNING |
| 近20日回撤 > 5% | 告警 | ALERT |
| 累计回撤 > 8% | 告警 | ALERT |
| 累计回撤 > 10% | 紧急 | CRITICAL |

### 5. 流动性风险

| 规则 | 阈值 | 级别 |
|------|------|------|
| 持仓超过个股日均成交额 20% | 预警 | WARNING |
| 持仓超过个股日均成交额 30% | 告警 | ALERT |
| 预计清仓天数 > 5 日 | 告警 | ALERT |

### 6. 涨跌停监控

| 规则 | 级别 |
|------|------|
| 持仓个股跌停 | ALERT |
| 持仓个股触及跌停后打开 | INFO |
| 持仓中 ≥ 3 只个股跌幅 > 5% | WARNING |

## 告警输出格式

```
⚠️ [ALERT] 持仓风险预警 — 2026-02-27 10:35:22

[单票集中度] 贵州茅台 (600519.SH) 持仓占比 12.3%，超过 10% 阈值
  - 当前市值: 1,850万
  - 组合总市值: 1.5亿
  - 建议: 减仓至 10% 以下

[行业偏离] 食品饮料行业超配 13.2%
  - 组合权重: 25.5%
  - 基准权重: 12.3%
  - 建议: 关注行业集中风险

[回撤预警] 近20日组合回撤 -5.2%
  - 峰值日: 2026-02-10 (净值 1.152)
  - 当前净值: 1.092
  - 回撤预算剩余: 2.8% (总预算 8%)
```

## 运行模式

### Daemon 生命周期

```
启动 → 加载持仓配置 → 进入监控循环
  ↓
  每 60 秒:
    1. 获取最新行情
    2. 计算组合净值和权重
    3. 逐条检查监控规则
    4. 如有告警 → 推送通知 + 记录日志
    5. 发送心跳信号
  ↓
  交易时段外:
    降低检查频率至 5 分钟
    仅检查隔夜风险（汇率、外盘联动）
```

### 交易时段

| 市场 | 交易时段 | 时区 |
|------|---------|------|
| A 股 | 09:30-11:30, 13:00-15:00 | CST |
| 港股 | 09:30-12:00, 13:00-16:00 | HKT |
| 集合竞价 | 09:15-09:25 (A股) | CST |

非交易时段自动降频，节省资源。

## 配置参数

```yaml
position_risk:
  portfolio_source: "portfolio.csv"
  benchmark: "000300.SH"
  check_interval: 60              # 秒
  off_hours_interval: 300         # 非交易时段间隔
  thresholds:
    single_stock_warn: 0.10
    single_stock_alert: 0.15
    sector_overweight_warn: 0.10
    var_budget_daily_95: 0.02
    max_drawdown_alert: 0.08
  alert_channels:
    - type: clawx_notification
    - type: wechat_work
      webhook: ${WECHAT_WEBHOOK}
  quiet_hours:                    # 静默时间段（避免非交易时段频繁告警）
    - "15:30-09:00"
```
