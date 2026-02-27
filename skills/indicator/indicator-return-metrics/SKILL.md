---
name: indicator-return-metrics
description: |
  定义和计算投资组合常用收益风险指标：Sharpe Ratio, Information Ratio,
  Sortino Ratio, Calmar Ratio, 年化收益率, 最大回撤。包含年化处理、
  无风险利率选择、滚动窗口计算等实操细节。面向中国市场，默认使用
  中债国债到期收益率作为无风险利率基准。
version: 1.0.0
license: Apache-2.0
compatibility: "Requires Python 3.10+; numpy, pandas"
metadata:
  clawx-finance:
    layer: indicator
    markets: ["*"]
    assets: ["*"]
    roles: [pm, researcher, risk]
    run_mode: oneshot
    timeout: 300
    requires:
      skills: []
      env: []
      bins: [python3]
      mcp: []
      python_packages:
        - numpy>=1.24
        - pandas>=2.0
    tested_on:
      data_range: "2015-01-01/2025-12-31"
      markets_tested: [cn-a, us]
      benchmark: "CSI300, S&P500"
    reviewed_by: "金融工程团队"
    review_date: "2026-02-27"
    locale: zh-CN
    display_name_zh: "收益风险指标计算"
    display_name_en: "Return & Risk Metrics"
---

# 收益风险指标计算 (Return & Risk Metrics)

## 何时触发

当用户需要评估投资组合、个股或策略的收益风险表现时自动激活。

触发关键词：Sharpe, 夏普比率, 信息比率, Information Ratio, Sortino, Calmar,
年化收益, 最大回撤, MaxDrawdown, 绩效评估, 风险调整收益, 收益指标。

## 核心指标定义

### 1. 年化收益率 (Annualized Return)

**公式**：

```
R_annual = (1 + R_total) ^ (252 / N) - 1
```

- `R_total`：区间总收益率
- `N`：交易日数量
- 中国市场使用 **252 个交易日/年**（非 250 或 365）

**注意事项**：
- 日频数据用几何平均，非算术平均
- 跨年度计算需处理春节等长假期

### 2. Sharpe Ratio

**公式**：

```
Sharpe = (R_p - R_f) / σ_p
```

- `R_p`：组合年化收益率
- `R_f`：无风险利率（年化）
- `σ_p`：组合收益率年化标准差

**无风险利率选择（中国市场）**：

| 期限 | 基准利率 | 数据源 |
|------|---------|--------|
| 短期 (< 1Y) | Shibor 3M 或中债国债 1Y | Wind: M0017142 |
| 中期 (1-3Y) | 中债国债到期收益率 3Y | Wind: M0325687 |
| 长期 (> 3Y) | 中债国债到期收益率 10Y | Wind: M0325689 |
| 默认 | **中债国债到期收益率 1Y** | Wind: M0017142 |

**年化标准差计算**：

```
σ_annual = σ_daily × √252
```

### 3. Information Ratio (IR)

**公式**：

```
IR = (R_p - R_b) / TE
```

- `R_b`：基准收益率
- `TE`：跟踪误差 (Tracking Error) = std(R_p - R_b) × √252

**基准选择建议**：

| 投资范围 | 推荐基准 | Wind 代码 |
|---------|---------|-----------|
| A 股大盘 | 沪深 300 | 000300.SH |
| A 股小盘 | 中证 500 | 000905.SH |
| A 股全市场 | 中证全指 | 000985.CSI |
| 港股 | 恒生指数 | HSI.HI |
| 美股 | S&P 500 | SPX.GI |

### 4. Sortino Ratio

**公式**：

```
Sortino = (R_p - R_f) / DD
```

- `DD`：下行标准差，仅使用负收益计算

```python
downside_returns = returns[returns < 0]
DD = downside_returns.std() * np.sqrt(252)
```

### 5. Calmar Ratio

**公式**：

```
Calmar = R_annual / |MaxDrawdown|
```

### 6. 最大回撤 (Maximum Drawdown)

**公式**：

```
MaxDD = min((P_t - P_peak) / P_peak)  for all t
```

**输出要求**：同时输出回撤起始日、最低点日、恢复日（如已恢复）。

## 滚动窗口计算

对于时间序列分析，支持滚动窗口版本：

```python
def rolling_sharpe(returns, window=252, rf_annual=0.02):
    """
    滚动 Sharpe Ratio

    Parameters:
        returns: pd.Series, 日收益率序列 (index 为日期)
        window: int, 滚动窗口大小 (交易日)
        rf_annual: float, 年化无风险利率

    Returns:
        pd.Series, 滚动 Sharpe Ratio
    """
    rf_daily = (1 + rf_annual) ** (1/252) - 1
    excess = returns - rf_daily
    rolling_mean = excess.rolling(window).mean() * 252
    rolling_std = returns.rolling(window).std() * np.sqrt(252)
    return rolling_mean / rolling_std
```

## 输出格式

以结构化表格输出，包含：

| 指标 | 值 | 说明 |
|------|---|------|
| 年化收益率 | 12.8% | 几何年化 |
| 年化波动率 | 18.2% | 日收益率标准差 × √252 |
| Sharpe Ratio | 1.05 | 无风险利率: 国债1Y 2.1% |
| Information Ratio | 0.82 | 基准: 沪深300 |
| Sortino Ratio | 1.45 | 下行风险调整 |
| Calmar Ratio | 0.70 | 最大回撤: -18.3% |
| 最大回撤 | -18.3% | 2024-01-15 至 2024-02-05 |
| 回撤恢复天数 | 45 天 | 2024-03-22 恢复 |

## 边界条件

- 数据不足 30 个交易日时，提示"样本量不足，指标可能不稳定"
- 标准差为 0 时（如货币基金），Sharpe 标记为 N/A
- 无风险利率缺失时，默认使用 2.0% 年化常数
