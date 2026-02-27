---
name: data-wind-equity
description: |
  指导 AI 如何通过 Wind 金融终端获取 A 股和港股股票数据。
  覆盖行情数据、财务数据、估值数据、行业分类等核心数据集，
  包含 Wind API (WindPy / REST) 的字段映射、参数说明和典型调用示例。
version: 1.0.0
license: Apache-2.0
compatibility: "Requires Wind terminal license; WindPy for Python or Wind REST API"
metadata:
  clawx-finance:
    layer: data
    markets: [cn-a, hk]
    assets: [equity]
    roles: [pm, researcher, trader, risk]
    run_mode: oneshot
    timeout: 120
    requires:
      skills: []
      env: [WIND_USER, WIND_PASSWORD]
      bins: [python3]
      mcp: [wind]
      python_packages:
        - WindPy>=1.0
    tested_on:
      data_range: "2020-01-01/2026-02-27"
      markets_tested: [cn-a, hk]
    reviewed_by: "数据工程团队"
    review_date: "2026-02-27"
    locale: zh-CN
    display_name_zh: "Wind 股票数据获取"
    display_name_en: "Wind Equity Data"
---

# Wind 股票数据获取 (Wind Equity Data)

## 何时触发

当用户需要获取 A 股或港股的行情、财务、估值数据时自动激活。

触发关键词：Wind 数据, 万得, A 股行情, 股票价格, 财务报表,
估值数据, PE, PB, 净利润, 营收, Wind 接口, WindPy。

## Wind API 概览

Wind 提供两种 API 接口：

| 接口 | 适用场景 | 认证方式 |
|------|---------|---------|
| WindPy (Python SDK) | 本地终端环境 | Wind 终端登录 |
| Wind REST API | 远程/服务端 | Token 认证 |

## 核心数据函数

### 1. 实时行情快照 — `w.wsq()`

```python
from WindPy import w
w.start()

codes = "000001.SZ,600519.SH,00700.HK"
fields = "rt_last,rt_chg,rt_pct_chg,rt_vol,rt_amt,rt_high,rt_low,rt_open"

data = w.wsq(codes, fields)
```

| 字段 | 含义 | 单位 |
|------|------|------|
| rt_last | 最新价 | 元/港元 |
| rt_chg | 涨跌额 | 元/港元 |
| rt_pct_chg | 涨跌幅 | % |
| rt_vol | 成交量 | 股 |
| rt_amt | 成交额 | 元/港元 |
| rt_high/rt_low/rt_open | 最高/最低/开盘 | 元/港元 |

### 2. 历史行情序列 — `w.wsd()`

```python
data = w.wsd(
    "000001.SZ",
    "open,high,low,close,volume,amt,turn,pct_chg",
    "2025-01-01",
    "2025-12-31",
    "Period=D;PriceAdj=F"  # 日频，前复权
)
```

**复权参数**：

| PriceAdj | 含义 | 适用场景 |
|----------|------|---------|
| F | 前复权 | 技术分析、图表展示 |
| B | 后复权 | 收益率计算、回测 |
| (空) | 不复权 | 原始价格查看 |

### 3. 截面数据 — `w.wss()`

```python
data = w.wss(
    "000001.SZ,600519.SH",
    "pe_ttm,pb_lf,ps_ttm,roe_ttm,totalshare,mkt_cap_float",
    f"tradeDate={today};unit=1"
)
```

**常用估值字段**：

| 字段 | 含义 | 说明 |
|------|------|------|
| pe_ttm | 市盈率 (TTM) | 滚动12个月 |
| pb_lf | 市净率 (LF) | 最新报表 |
| ps_ttm | 市销率 (TTM) | 滚动12个月 |
| ev_ebitda | EV/EBITDA | 企业价值/息税折旧摊销前利润 |
| dividend_yield | 股息率 | 近12个月 |
| mkt_cap_float | 流通市值 | 亿元 |

**常用财务字段**：

| 字段 | 含义 | 报表 |
|------|------|------|
| roe_ttm | ROE (TTM) | 归母净利润/平均净资产 |
| roic_ttm | ROIC (TTM) | 投入资本回报率 |
| grossprofitmargin | 毛利率 | 年报/季报 |
| operatingprofitmargin | 营业利润率 | 年报/季报 |
| debttoassets | 资产负债率 | 最新报表 |
| currentratio | 流动比率 | 最新报表 |

### 4. 板块成分 — `w.wset()`

```python
# 沪深300成分股
data = w.wset(
    "sectorconstituent",
    f"date={today};sectorid=a]001030300000000;field=wind_code,sec_name,weight"
)

# 行业分类 (申万一级)
data = w.wset(
    "sectorconstituent",
    f"date={today};sectorid=a]001034000000000;field=wind_code,sec_name"
)
```

**常用板块 ID**：

| 板块 | sectorid | 说明 |
|------|----------|------|
| 沪深300 | a001030300000000 | 大盘蓝筹 |
| 中证500 | a001030500000000 | 中盘成长 |
| 中证1000 | a001031000000000 | 小盘 |
| 创业板 | a001003147000000 | 创业板全部 |
| 科创板 | a001003688000000 | 科创板全部 |

### 5. 财务报表 — 财报季节注意事项

A 股财报披露时间表：

| 报告期 | 披露截止日 | 预披露 |
|--------|-----------|--------|
| 年报 | 次年 4月30日 | 业绩快报 1-2月 |
| 一季报 | 4月30日 | — |
| 半年报 | 8月31日 | — |
| 三季报 | 10月31日 | — |

使用财务数据时注意 **时点数据 (Point-in-Time)** ——回测时应使用实际披露日期，
避免使用未来数据（前视偏差）。Wind 字段 `stm_issuingdate` 可获取实际披露日期。

## 港股数据注意事项

- Wind 代码格式：`00700.HK`（腾讯）、`09988.HK`（阿里巴巴）
- 港股通标的使用 `.HK` 后缀
- 货币单位：港元 (HKD)，需注意汇率转换
- 交易时间：09:30-12:00, 13:00-16:00 (HKT)
- 港股无涨跌停限制

## 错误处理

| 错误码 | 含义 | 处理方式 |
|--------|------|---------|
| -40520007 | Wind 未登录 | 提示用户启动 Wind 终端 |
| -40521001 | 数据权限不足 | 提示检查 Wind 账户权限 |
| -40520004 | 请求超时 | 缩小请求范围后重试 |
| -40520008 | 字段名错误 | 检查字段拼写 |

## 最佳实践

1. **批量请求**：单次 `wss` 最多 3000 只股票，超过时分批
2. **频率控制**：两次请求间隔 ≥ 0.5 秒，避免被限流
3. **缓存策略**：日频数据每日更新一次即可，盘中行情按需获取
4. **后复权回测**：收益率计算使用后复权 (PriceAdj=B)
