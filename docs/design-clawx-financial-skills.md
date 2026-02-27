# ClawX Financial Skills — 技术方案设计

> v0.1 · 2026-02-27

---

## 目录

1. [定位与差异化](#1-定位与差异化)
2. [核心设计原则](#2-核心设计原则)
3. [原子能力模型](#3-原子能力模型)
4. [Skills 分类体系](#4-skills-分类体系)
5. [Skill 格式规范](#5-skill-格式规范)
6. [目录结构](#6-目录结构)
7. [预装与分发架构](#7-预装与分发架构)
8. [长周期运行架构](#8-长周期运行架构)
9. [质量门控与审核](#9-质量门控与审核)
10. [与 ClawX 集成方案](#10-与-clawx-集成方案)
11. [分阶段落地路线](#11-分阶段落地路线)
12. [与现有生态的关系](#12-与现有生态的关系)

---

## 1. 定位与差异化

### 1.1 我们不是什么

| 对标项 | ClawhHub (现状) | anthropics/financial-services-plugins | **ClawX Financial Skills (我们)** |
|--------|----------------|--------------------------------------|----------------------------------|
| 规模 | 5,700+ skills，多杂乱 | 5 插件 41 skills | **50-100 个精选原子能力** |
| 目标用户 | 全球通用开发者 | 欧美投行/卖方 | **中国机构买方 → 卖方 → 多资产** |
| 市场覆盖 | 无金融专门分类 | 美股为主 | **A/港/美 → Crypto → 东亚** |
| 能力定位 | 简单工具 Skill | 写报告为主 | **原子能力 + 长周期 7×24h 运行** |
| 分发方式 | 在线市场自行安装 | Claude 插件市场 | **预装到 ClawX 桌面产品** |
| 数据连接 | 无 | MCP (欧美数据源) | **MCP (中国数据源优先)** |
| 质量保障 | 自动扫描 | GitHub PR 审核 | **专家人工审核 + 回测验证** |

### 1.2 核心差异

1. **小而精 vs 大而全**：不追求数量，每个 Skill 都经过金融专家审核
2. **原子能力 vs 报告生成**：不是"帮你写一篇研报"，而是"教 AI 怎么找到 Wind 数据、怎么算 Sharpe Ratio、怎么做事件回测"
3. **长周期运行 vs 单次对话**：Skills 设计为可编排进 Cron 任务、监控管线、回测流水线
4. **预装信任 vs 市场自选**：随 ClawX 分发，用户开箱即用，零配置门槛
5. **中国市场优先**：数据源、合规、术语、指标体系对标中国机构实践

---

## 2. 核心设计原则

### P1: 原子性 (Atomic)

每个 Skill 只做一件事，做到极致。不写"投研全流程"，而是拆成：
- `data-wind-equity` — 从 Wind 拉 A 股行情
- `indicator-sharpe-ratio` — 计算 Sharpe Ratio
- `backtest-event-driven` — 事件驱动回测框架

### P2: 可编排性 (Composable)

原子 Skill 通过 **Pipeline 定义** 组合成工作流。一个回测任务 = 数据获取 + 因子计算 + 信号生成 + 回测执行 + 报告输出。

### P3: 长周期感知 (Long-Running Aware)

Skill 声明自己是 `oneshot`（单次执行）还是 `daemon`（长驻）还是 `cron`（定时），运行时据此调度。

### P4: 市场分区 (Market-Partitioned)

数据层按市场分区 (A/HK/US/Crypto)，指标层按资产类型 (equity/bond/derivative/crypto)，应用层按角色 (buy-side/sell-side)。

### P5: 预装优先 (Bundled-First)

Skills 随 ClawX release 打包分发，版本与 ClawX 绑定。用户也可通过 CLI 单独更新。

---

## 3. 原子能力模型

### 3.1 能力分层

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: Application Workflows (应用工作流)                  │
│  ┌─────────────┐ ┌────────────┐ ┌──────────────┐           │
│  │ 晨会速递     │ │ 因子回测   │ │ 持仓监控      │           │
│  │ morning-brief│ │ factor-bt  │ │ position-mon │           │
│  └──────┬──────┘ └─────┬──────┘ └──────┬───────┘           │
├─────────┼──────────────┼───────────────┼────────────────────┤
│  Layer 3: Analytics & Strategy (分析与策略)                    │
│  ┌──────┴──────┐ ┌─────┴──────┐ ┌──────┴───────┐           │
│  │ 估值分析     │ │ 因子模型   │ │ 风险归因      │           │
│  │ valuation   │ │ factor     │ │ risk-attrib  │           │
│  └──────┬──────┘ └─────┬──────┘ └──────┬───────┘           │
├─────────┼──────────────┼───────────────┼────────────────────┤
│  Layer 2: Indicators & Computation (指标与计算)                │
│  ┌──────┴──────┐ ┌─────┴──────┐ ┌──────┴───────┐           │
│  │ Sharpe/IR   │ │ 技术指标    │ │ 财务指标      │           │
│  │ perf-metric │ │ tech-indic │ │ fin-metric   │           │
│  └──────┬──────┘ └─────┬──────┘ └──────┬───────┘           │
├─────────┼──────────────┼───────────────┼────────────────────┤
│  Layer 1: Data & Tooling (数据与工具)                         │
│  ┌──────┴──────┐ ┌─────┴──────┐ ┌──────┴───────┐           │
│  │ Wind/iFind  │ │ Bloomberg  │ │ Excel/PPT    │           │
│  │ data-source │ │ data-intl  │ │ tool-ops     │           │
│  └─────────────┘ └────────────┘ └──────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 原子能力类型

| 类型 | 前缀 | 说明 | 示例 |
|------|------|------|------|
| **数据获取** | `data-` | 教 AI 怎么找到和拉取数据 | `data-wind-equity`, `data-eastmoney-fund` |
| **工具操作** | `tool-` | 教 AI 怎么操作软件/API | `tool-excel-model`, `tool-ppt-template` |
| **指标定义** | `indicator-` | 定义指标的计算方法和含义 | `indicator-sharpe`, `indicator-pe-band` |
| **回测验证** | `backtest-` | 定义回测框架和验证方法 | `backtest-factor`, `backtest-event` |
| **分析模型** | `model-` | 分析框架和建模方法论 | `model-dcf`, `model-comps`, `model-lbo` |
| **监控告警** | `monitor-` | 长驻监控和告警规则 | `monitor-position`, `monitor-risk-limit` |
| **报告生成** | `report-` | 结构化报告模板和生成逻辑 | `report-morning-brief`, `report-ic-memo` |
| **合规检查** | `compliance-` | 合规规则和检查流程 | `compliance-concentration`, `compliance-restricted` |

---

## 4. Skills 分类体系

### 4.1 市场维度 (market)

```yaml
markets:
  cn-a:
    name: "A 股"
    data_sources: [wind, ifind, eastmoney, tushare, akshare]
    exchanges: [SSE, SZSE, BSE]
    currency: CNY
    timezone: Asia/Shanghai
  hk:
    name: "港股"
    data_sources: [wind, bloomberg, aastocks]
    exchanges: [HKEX]
    currency: HKD
    timezone: Asia/Hong_Kong
  us:
    name: "美股"
    data_sources: [bloomberg, factset, yahoo-finance]
    exchanges: [NYSE, NASDAQ]
    currency: USD
    timezone: America/New_York
  crypto:                        # Phase 2
    name: "加密货币"
    data_sources: [binance, okx, coingecko]
    exchanges: [binance, okx, bybit]
    currency: [USDT, USD]
    timezone: UTC
  jp:                            # Phase 3
    name: "日股"
    data_sources: [bloomberg, nikkei]
    exchanges: [TSE]
    currency: JPY
    timezone: Asia/Tokyo
  kr:                            # Phase 3
    name: "韩股"
    data_sources: [bloomberg]
    exchanges: [KRX]
    currency: KRW
    timezone: Asia/Seoul
```

### 4.2 资产类型维度 (asset)

```yaml
assets:
  equity:       "股票"
  bond:         "债券"
  fund:         "基金"
  derivative:   "衍生品"
  commodity:    "大宗商品"
  fx:           "外汇"
  crypto:       "加密货币"
  reit:         "REITs"
  multi:        "多资产"
```

### 4.3 角色维度 (role)

```yaml
roles:
  buy-side:
    pm:         "投资组合经理"
    researcher: "买方研究员"
    trader:     "交易员"
    risk:       "风控"
    compliance: "合规"
  sell-side:
    analyst:    "卖方分析师"
    sales:      "销售/客户服务"
    ib:         "投行"
```

### 4.4 Phase 1 Skills 清单（中国机构买方 · A/港/美）

**Layer 1 — 数据与工具 (12 Skills)**

| Skill Slug | 名称 | 市场 | 资产 |
|---|---|---|---|
| `data-wind-equity` | Wind 股票数据获取 | cn-a, hk | equity |
| `data-wind-fund` | Wind 基金数据获取 | cn-a | fund |
| `data-wind-bond` | Wind 债券数据获取 | cn-a | bond |
| `data-ifind-equity` | iFind 股票数据获取 | cn-a | equity |
| `data-eastmoney-api` | 东方财富接口数据 | cn-a | equity, fund |
| `data-tushare-market` | Tushare 行情数据 | cn-a | equity |
| `data-bloomberg-intl` | Bloomberg 国际市场数据 | us, hk | equity, bond |
| `data-exchange-announce` | 交易所公告抓取 | cn-a | equity |
| `data-macro-cn` | 中国宏观经济数据 | cn-a | multi |
| `tool-excel-financial-model` | Excel 财务模型操作 | * | * |
| `tool-ppt-report-template` | PPT 研报模板操作 | * | * |
| `tool-python-quant-env` | Python 量化环境配置 | * | * |

**Layer 2 — 指标与计算 (10 Skills)**

| Skill Slug | 名称 | 资产 |
|---|---|---|
| `indicator-return-metrics` | 收益指标 (Sharpe/IR/Sortino/Calmar) | * |
| `indicator-risk-metrics` | 风险指标 (VaR/CVaR/MaxDD/Volatility) | * |
| `indicator-valuation` | 估值指标 (PE/PB/PS/EV-EBITDA/PE-Band) | equity |
| `indicator-financial-quality` | 财务质量指标 (ROE/DuPont/FCF) | equity |
| `indicator-technical` | 技术指标 (MA/MACD/RSI/Bollinger) | equity, crypto |
| `indicator-factor-barra` | Barra 因子定义 (CNE5/CNE6) | equity |
| `indicator-factor-custom` | 自定义因子框架 | equity |
| `indicator-credit-spread` | 信用利差指标 | bond |
| `indicator-fund-performance` | 基金业绩归因 (Brinson) | fund |
| `indicator-liquidity` | 流动性指标 (Amihud/Turnover/Bid-Ask) | equity |

**Layer 3 — 分析与策略 (8 Skills)**

| Skill Slug | 名称 | 角色 |
|---|---|---|
| `model-dcf-cn` | DCF 估值模型 (A 股适配) | researcher, pm |
| `model-comps-cn` | 可比公司分析 (A 股适配) | researcher |
| `model-multi-factor` | 多因子选股模型 | pm, researcher |
| `model-risk-attribution` | 风险归因分析 | risk, pm |
| `model-portfolio-optimize` | 组合优化 (Black-Litterman) | pm |
| `model-event-study` | 事件研究框架 | researcher |
| `model-sector-rotation` | 行业轮动模型 | pm |
| `model-macro-regime` | 宏观经济体制识别 | pm, researcher |

**Layer 4 — 应用工作流 (8 Skills)**

| Skill Slug | 名称 | 运行模式 |
|---|---|---|
| `report-morning-brief` | 晨会纪要 | cron (daily 7:30 CST) |
| `report-earnings-review` | 业绩点评 | oneshot |
| `report-industry-weekly` | 行业周报 | cron (weekly) |
| `monitor-position-risk` | 持仓风险监控 | daemon |
| `monitor-announcement` | 重要公告监控 | daemon |
| `monitor-factor-decay` | 因子衰减监控 | cron (daily) |
| `backtest-factor-ic` | 因子 IC/IR 回测 | oneshot |
| `backtest-strategy-pnl` | 策略 PnL 回测 | oneshot |

**共计 38 个 Phase 1 Skills**

---

## 5. Skill 格式规范

### 5.1 基础格式

兼容 Agent Skills Spec (`SKILL.md` + YAML frontmatter)，在 `metadata` 中扩展金融领域字段。

```yaml
---
name: indicator-return-metrics
description: |
  定义和计算投资组合常用收益指标：Sharpe Ratio, Information Ratio,
  Sortino Ratio, Calmar Ratio。包含年化处理、无风险利率选择、
  滚动窗口计算等实操细节。
version: 1.0.0
license: Apache-2.0
metadata:
  clawx-finance:
    # ---- 分类 ----
    layer: indicator             # data | tool | indicator | backtest | model | monitor | report | compliance
    markets: ["*"]               # cn-a | hk | us | crypto | * (通配)
    assets: ["*"]                # equity | bond | fund | derivative | crypto | *
    roles: [pm, researcher, risk]
    
    # ---- 运行模式 ----
    run_mode: oneshot            # oneshot | daemon | cron
    cron_schedule: null          # cron 表达式，仅 run_mode=cron 时有效
    timeout: 300                 # 单次执行超时 (秒)
    
    # ---- 依赖与环境 ----
    requires:
      skills: []                 # 依赖的其他 Skill slugs
      env: []                    # 需要的环境变量
      bins: [python3]            # 需要的系统命令
      mcp: []                    # 需要的 MCP 连接器
      python_packages:           # Python 依赖
        - numpy>=1.24
        - pandas>=2.0
    
    # ---- 质量元数据 ----
    tested_on:                   # 验证信息
      data_range: "2015-01-01/2025-12-31"
      markets_tested: [cn-a, us]
      benchmark: "CSI300, S&P500"
    reviewed_by: "金融工程团队"   # 审核方
    review_date: "2026-02-20"
    
    # ---- 国际化 ----
    locale: zh-CN                # 主要语言
    display_name_zh: "收益指标计算"
    display_name_en: "Return Metrics"
---

# 收益指标计算 (Return Metrics)

## 何时触发

当用户需要评估投资组合或策略的收益表现时自动激活。
触发关键词：Sharpe, 信息比率, Sortino, 收益分析, 绩效评估。

## 指标定义

### Sharpe Ratio

...（详细的计算方法、公式、注意事项、代码示例）
```

### 5.2 与标准 SKILL.md 的兼容性

| 标准字段 | 状态 | 说明 |
|----------|------|------|
| `name` | 保持 | 沿用 |
| `description` | 保持 | 沿用 |
| `version` | 保持 | SemVer |
| `license` | 保持 | 沿用 |
| `compatibility` | 保持 | 沿用 |
| `metadata` | **扩展** | 在 `metadata.clawx-finance` 命名空间下扩展 |
| `allowed-tools` | 保持 | 沿用 |

所有扩展字段放在 `metadata.clawx-finance` 下，不修改标准字段，保持与 ClawhHub/OpenClaw 的完全兼容。

---

## 6. 目录结构

### 6.1 仓库结构

```
clawx-financial-skills/
├── SKILL-SPEC.md                    # 本项目的 Skill 格式规范
├── CONTRIBUTING.md                  # 贡献指南
├── LICENSE                          # Apache-2.0
│
├── registry.json                    # Skills 注册清单 (自动生成)
├── registry-schema.json             # 注册清单 JSON Schema
│
├── skills/                          # 所有 Skills
│   ├── data/                        # Layer 1: 数据获取
│   │   ├── data-wind-equity/
│   │   │   ├── SKILL.md
│   │   │   ├── scripts/
│   │   │   │   └── wind_api_guide.py
│   │   │   └── references/
│   │   │       └── wind_api_fields.md
│   │   ├── data-wind-fund/
│   │   ├── data-bloomberg-intl/
│   │   └── ...
│   │
│   ├── tool/                        # Layer 1: 工具操作
│   │   ├── tool-excel-financial-model/
│   │   └── ...
│   │
│   ├── indicator/                   # Layer 2: 指标定义
│   │   ├── indicator-return-metrics/
│   │   ├── indicator-risk-metrics/
│   │   ├── indicator-valuation/
│   │   └── ...
│   │
│   ├── backtest/                    # Layer 2: 回测验证
│   │   ├── backtest-factor-ic/
│   │   └── ...
│   │
│   ├── model/                       # Layer 3: 分析模型
│   │   ├── model-dcf-cn/
│   │   ├── model-multi-factor/
│   │   └── ...
│   │
│   ├── monitor/                     # Layer 4: 监控告警
│   │   ├── monitor-position-risk/
│   │   └── ...
│   │
│   ├── report/                      # Layer 4: 报告生成
│   │   ├── report-morning-brief/
│   │   └── ...
│   │
│   └── compliance/                  # Layer 4: 合规检查
│       └── ...
│
├── bundles/                         # 预设 Skill 组合包
│   ├── buy-side-equity-cn.json      # 买方 A 股权益研究
│   ├── buy-side-multi-asset.json    # 买方多资产
│   ├── quant-researcher.json        # 量化研究员
│   └── risk-manager.json            # 风控经理
│
├── mcp/                             # MCP 连接器配置
│   ├── wind.json                    # Wind MCP 配置
│   ├── ifind.json                   # iFind MCP 配置
│   ├── eastmoney.json               # 东方财富 MCP 配置
│   └── bloomberg.json               # Bloomberg MCP 配置
│
├── pipelines/                       # Pipeline 编排模板
│   ├── morning-brief-pipeline.yaml  # 晨会纪要流水线
│   ├── factor-backtest-pipeline.yaml
│   └── risk-monitoring-pipeline.yaml
│
├── scripts/                         # 构建与验证工具
│   ├── build-registry.ts            # 生成 registry.json
│   ├── validate-skills.ts           # 验证所有 Skill 格式
│   ├── run-skill-tests.ts           # 运行 Skill 内测试
│   └── bundle-for-clawx.ts          # 为 ClawX 打包
│
└── tests/                           # 集成测试
    ├── registry.test.ts
    ├── skill-format.test.ts
    └── pipeline.test.ts
```

### 6.2 单个 Skill 目录结构

```
indicator-return-metrics/
├── SKILL.md                  # 必需：主文件 (frontmatter + 指令)
├── scripts/                  # 可选：辅助脚本
│   ├── calculate_sharpe.py
│   └── rolling_metrics.py
├── references/               # 可选：参考文档
│   ├── formulas.md
│   └── risk_free_rates.md
├── templates/                # 可选：输出模板
│   └── metrics_report.md
└── tests/                    # 可选：验证用例
    ├── test_data.csv
    └── expected_output.json
```

---

## 7. 预装与分发架构

### 7.1 分发模型

```
                              ┌──────────────────┐
                              │  clawx-financial  │
                              │  -skills repo     │
                              │  (本仓库)          │
                              └────────┬─────────┘
                                       │
                         ┌─────────────┼─────────────┐
                         │             │             │
                         ▼             ▼             ▼
               ┌─────────────┐ ┌────────────┐ ┌───────────┐
               │  ClawX 预装  │ │  CLI 独立  │ │ ClawhHub  │
               │  (打包到 app)│ │  安装/更新  │ │ 同步发布   │
               └─────────────┘ └────────────┘ └───────────┘
                    (主)            (辅)           (兼容)
```

### 7.2 ClawX 预装集成

ClawX 当前通过 `clawhub` npm 包 + `ClawHubService` 类管理 Skills。我们扩展此机制：

**方案：Bundled Skills 目录**

```typescript
// ClawX 中新增的类型定义
interface BundledSkillManifest {
  version: string;                    // 与 ClawX 版本绑定
  skills: BundledSkillEntry[];
  bundles: SkillBundle[];
}

interface BundledSkillEntry {
  slug: string;
  version: string;
  layer: 'data' | 'tool' | 'indicator' | 'backtest' | 'model' | 'monitor' | 'report' | 'compliance';
  run_mode: 'oneshot' | 'daemon' | 'cron';
  markets: string[];
  assets: string[];
  enabled_by_default: boolean;        // 是否默认启用
  bundle_ids: string[];               // 属于哪些预设包
}
```

**ClawX 构建时集成**：

```
ClawX build pipeline:
  1. pnpm run build:vite
  2. zx scripts/bundle-openclaw.mjs
  3. zx scripts/bundle-financial-skills.mjs   ← 新增
     - 从 clawx-financial-skills repo 拉取 registry.json
     - 下载/复制所有 skills/ 到 resources/bundled-skills/
     - 生成 bundled-manifest.json
  4. electron-builder
```

**运行时加载**：

```typescript
// electron/gateway/financialSkills.ts (新增)
export class FinancialSkillsService {
  private bundledDir: string;
  private userDir: string;

  constructor() {
    // 预装目录 (只读，随 app 分发)
    this.bundledDir = path.join(app.getAppPath(), 'resources', 'bundled-skills');
    // 用户目录 (可写，用于更新和自定义)
    this.userDir = path.join(getOpenClawConfigDir(), 'financial-skills');
  }

  /**
   * 加载 skill 时按优先级：user > bundled
   * 用户更新过的版本优先于预装版本
   */
  async resolveSkill(slug: string): Promise<SkillResolution> {
    const userPath = path.join(this.userDir, slug);
    const bundledPath = path.join(this.bundledDir, slug);

    if (fs.existsSync(userPath)) {
      return { source: 'user', path: userPath };
    }
    if (fs.existsSync(bundledPath)) {
      return { source: 'bundled', path: bundledPath };
    }
    return { source: 'not_found', path: null };
  }

  /**
   * 根据 bundle 配置激活一组 skills
   */
  async activateBundle(bundleId: string): Promise<void> {
    const manifest = await this.loadManifest();
    const bundle = manifest.bundles.find(b => b.id === bundleId);
    // 启用 bundle 中的所有 skills
  }
}
```

### 7.3 更新策略

| 更新方式 | 触发条件 | 说明 |
|----------|---------|------|
| **随 ClawX 大版本更新** | ClawX release | Skills 打包在 app 内，版本绑定 |
| **独立热更新** | 用户手动 / 后台检查 | 通过 registry.json 比对，增量下载变更 |
| **ClawhHub 兼容更新** | `clawhub update` | 标准 ClawhHub CLI 路径，社区兼容 |

热更新流程：

```
ClawX 启动 → 检查 registry.json 远程版本
  → 有更新 → 展示更新提示 (不强制)
    → 用户确认 → 增量下载变更的 Skills → 写入 userDir
    → 下次 Agent 会话生效
```

---

## 8. 长周期运行架构

### 8.1 运行模式定义

```yaml
run_modes:
  oneshot:
    description: "单次执行，完成即退出"
    examples: [backtest-factor-ic, model-dcf-cn, report-earnings-review]
    scheduling: "用户触发 或 Pipeline 调用"
    timeout: 300-3600s

  cron:
    description: "定时执行，按 cron 表达式调度"
    examples: [report-morning-brief, monitor-factor-decay]
    scheduling: "ClawX Cron 系统调度"
    cron_expr: "30 7 * * 1-5"    # 工作日 7:30
    timeout: 600s
    retry: { max_attempts: 3, backoff: exponential }

  daemon:
    description: "长驻运行，持续监控"
    examples: [monitor-position-risk, monitor-announcement]
    scheduling: "ClawX 启动时自动拉起"
    heartbeat: 60s
    restart_policy: always
    resource_limits:
      memory: 512MB
      cpu: 0.5
```

### 8.2 与 ClawX Cron 系统集成

ClawX 已有 Cron 页面 (`src/pages/Cron`)。Financial Skills 的 `cron` 模式直接对接：

```typescript
// Skill 声明 cron 模式后，ClawX 自动注册 cron 任务
interface FinancialCronTask {
  skill_slug: string;
  cron_expr: string;
  timezone: string;              // 关键：金融市场时区
  market_calendar: string;       // 交易日历 (跳过节假日)
  params: Record<string, any>;   // 运行时参数
  on_failure: 'retry' | 'alert' | 'skip';
  alert_channel?: string;        // 失败通知渠道
}
```

交易日历感知：

```yaml
# 晨会纪要不在节假日运行
skill: report-morning-brief
cron_schedule: "30 7 * * 1-5"
market_calendar: cn-a           # 使用 A 股交易日历
skip_holidays: true             # 跳过法定节假日
pre_market_only: true           # 仅交易日早盘前
```

### 8.3 Pipeline 编排

Pipeline 将多个原子 Skill 组合为一个工作流：

```yaml
# pipelines/morning-brief-pipeline.yaml
name: morning-brief
description: "买方晨会纪要全流程"
schedule:
  cron: "00 7 * * 1-5"
  timezone: Asia/Shanghai
  market_calendar: cn-a

steps:
  - id: fetch_market_data
    skill: data-wind-equity
    params:
      scope: portfolio_holdings
      fields: [close, volume, turnover, limit_up, limit_down]
    timeout: 120s

  - id: fetch_macro
    skill: data-macro-cn
    params:
      indicators: [PMI, CPI, PPI, shibor, lpr]
    timeout: 60s
    parallel_with: fetch_market_data    # 并行执行

  - id: calc_overnight
    skill: indicator-return-metrics
    depends_on: [fetch_market_data]
    params:
      window: 1d
      metrics: [return, volume_change, turnover_ratio]

  - id: scan_announcements
    skill: data-exchange-announce
    params:
      scope: portfolio_holdings
      since: last_trading_close
    parallel_with: calc_overnight

  - id: generate_brief
    skill: report-morning-brief
    depends_on: [calc_overnight, fetch_macro, scan_announcements]
    params:
      template: standard
      language: zh-CN
      sections: [market_overview, portfolio_impact, macro_update, key_events]

  - id: distribute
    action: notify
    depends_on: [generate_brief]
    channels: [wechat_work, email]
    recipients: ${team.investment_committee}
```

### 8.4 Daemon 模式架构

```
ClawX Process
  └── OpenClaw Gateway (port 18789)
       └── Agent Session
            ├── [oneshot] 用户对话触发
            ├── [cron] Cron 调度器触发
            └── [daemon] DaemonManager 管理
                 ├── monitor-position-risk  (heartbeat: 60s)
                 │    └── 检测持仓偏离 → 触发告警
                 └── monitor-announcement   (heartbeat: 30s)
                      └── 轮询公告 → 匹配持仓 → 推送通知
```

---

## 9. 质量门控与审核

### 9.1 审核流程（区别于 ClawhHub）

ClawhHub 依赖自动化扫描（VirusTotal + LLM）。我们采用 **专家人工审核 + 自动化验证** 双轨制：

```
提交 PR → 自动验证 → 专家审核 → 回测验证 → 合并发布
```

#### 自动验证 (CI)

```yaml
# .github/workflows/validate-skill.yml
checks:
  - format:     # SKILL.md 格式、frontmatter schema 校验
  - metadata:   # clawx-finance 字段完整性
  - references: # 引用的公式、指标定义是否完整
  - scripts:    # Python 脚本 lint + type check
  - tests:      # Skill 内 tests/ 目录的用例通过
  - registry:   # registry.json 一致性
```

#### 专家审核 (Human Review)

| 审核维度 | 检查内容 | 审核人 |
|---------|---------|--------|
| **金融准确性** | 公式正确、术语规范、符合行业惯例 | 金融工程师 |
| **数据可靠性** | 数据源可用、字段映射正确 | 数据工程师 |
| **实操可用性** | AI 能否按指令执行、边界条件处理 | AI 工程师 |
| **合规性** | 不含内幕信息、不构成投资建议 | 合规人员 |

#### 回测验证 (Quantitative Validation)

对于 `indicator-`、`backtest-`、`model-` 类 Skill，要求提供：

```yaml
# SKILL.md frontmatter
metadata:
  clawx-finance:
    tested_on:
      data_range: "2015-01-01/2025-12-31"
      markets_tested: [cn-a]
      benchmark: CSI300
      metrics:
        ic_mean: 0.035           # 因子 IC 均值
        ic_ir: 0.42              # IC 信息比率
        annual_return: 0.128     # 年化收益
        max_drawdown: -0.183     # 最大回撤
        sharpe_ratio: 1.05       # Sharpe Ratio
      methodology: |
        使用 CSI300 成分股，月度调仓，
        费率双边 0.3%，滑点 0.1%
```

### 9.2 质量等级

| 等级 | 标识 | 含义 |
|------|------|------|
| **verified** | 金色盾牌 | 通过全部审核 + 回测验证 |
| **reviewed** | 蓝色勾号 | 通过专家审核，无回测数据 |
| **community** | 灰色标签 | 社区贡献，仅通过自动验证 |

Phase 1 全部 Skills 必须达到 **verified** 等级。

---

## 10. 与 ClawX 集成方案

### 10.1 集成架构总图

```
┌──────────────────────────────────────────────────────────────┐
│                        ClawX Desktop                         │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    Electron Main Process                 │ │
│  │                                                         │ │
│  │  ┌───────────────┐  ┌───────────────────────────────┐   │ │
│  │  │ ClawHubService│  │ FinancialSkillsService (新增)  │   │ │
│  │  │ (现有)         │  │                               │   │ │
│  │  │ - search      │  │ - resolveSkill (bundled/user) │   │ │
│  │  │ - install     │  │ - activateBundle              │   │ │
│  │  │ - uninstall   │  │ - checkUpdates               │   │ │
│  │  │ - list        │  │ - hotUpdate                  │   │ │
│  │  └───────┬───────┘  │ - getPipelines               │   │ │
│  │          │          │ - getMarketCalendar           │   │ │
│  │          │          └───────────────┬───────────────┘   │ │
│  │          │                          │                   │ │
│  │  ┌───────┴──────────────────────────┴───────────────┐   │ │
│  │  │            OpenClaw Gateway (port 18789)          │   │ │
│  │  │                                                   │   │ │
│  │  │  Skills 目录加载顺序:                               │   │ │
│  │  │  1. ~/.openclaw/financial-skills/ (用户覆盖)       │   │ │
│  │  │  2. <app>/resources/bundled-skills/ (预装)         │   │ │
│  │  │  3. ~/.openclaw/skills/ (ClawhHub 社区)            │   │ │
│  │  └───────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   Renderer Process (React)               │ │
│  │                                                         │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │ │
│  │  │  Skills   │ │  Cron    │ │  Chat    │ │ Dashboard │  │ │
│  │  │  页面     │ │  页面    │ │  页面    │ │  页面     │  │ │
│  │  │          │ │          │ │          │ │           │  │ │
│  │  │ 金融Skill │ │ Pipeline │ │ 原子能力  │ │ 监控面板  │  │ │
│  │  │ 分类浏览  │ │ 可视编排  │ │ 对话触发  │ │ 运行状态  │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 10.2 UI 扩展点

在 ClawX 现有页面基础上扩展：

**Skills 页面扩展**：
- 新增"金融专业"分类 Tab，按 Layer 1-4 分层展示
- Bundle 快速激活："一键启用买方权益研究工具包"
- 市场/资产/角色三维筛选器
- 质量等级标识 (verified/reviewed/community)

**Cron 页面扩展**：
- Pipeline 可视化编排器
- 交易日历感知的调度展示
- 执行历史和失败告警

**Dashboard 扩展**：
- Daemon Skills 运行状态
- 今日执行概览
- 最近告警

### 10.3 MCP 连接器预配置

```json
// mcp/wind.json
{
  "mcpServers": {
    "wind": {
      "type": "stdio",
      "command": "python3",
      "args": ["-m", "wind_mcp_server"],
      "env": {
        "WIND_USER": "${WIND_USER}",
        "WIND_PASSWORD": "${WIND_PASSWORD}"
      },
      "description": "Wind 金融终端 MCP 连接器",
      "install_guide": "pip install wind-mcp-server",
      "markets": ["cn-a", "hk"]
    }
  }
}
```

ClawX Settings 页面新增"数据源配置"区域，引导用户配置 Wind/iFind/Bloomberg 凭据。

---

## 11. 分阶段落地路线

### Phase 1: MVP（6-8 周）

**目标**：38 个 verified Skills + ClawX 预装 + 3 个 Pipeline

| 周 | 里程碑 |
|----|--------|
| W1-2 | 仓库搭建、格式规范、CI 验证管线、registry 生成脚本 |
| W3-4 | Layer 1 (12 Skills): 数据获取 + 工具操作 |
| W5-6 | Layer 2-3 (18 Skills): 指标计算 + 分析模型 |
| W7 | Layer 4 (8 Skills): 工作流 + Pipeline 编排 |
| W8 | ClawX 集成、Bundle 打包、预装测试 |

**交付**：
- `clawx-financial-skills` 仓库，38 个 verified Skills
- 4 个 Bundle 预设包 (买方权益/多资产/量化/风控)
- 3 个 Pipeline (晨会/因子回测/风险监控)
- ClawX `FinancialSkillsService` 集成代码
- Skills 页面金融分类 UI

### Phase 2: 扩展市场（4 周）

- Crypto 市场 Skills (10 个): `data-binance-*`, `indicator-crypto-*`, `model-defi-*`
- 卖方研究员 Skills (8 个): `report-initiation-*`, `model-industry-*`
- MCP 连接器扩展: Binance, OKX, Coingecko
- Pipeline 模板库扩展

### Phase 3: 东亚多市场（4 周）

- 日本市场 Skills: `data-nikkei-*`, `indicator-topix-*`
- 韩国市场 Skills: `data-krx-*`
- 多市场联动 Skills: `model-cross-market-*`, `monitor-global-risk`
- 国际化: 日/韩语 display_name

### Phase 4: 平台化（持续）

- 开放社区贡献通道 (community 等级)
- Skill 使用分析和推荐
- 私有 Skill 支持（机构自建）
- Skill 间依赖图和版本解析

---

## 12. 与现有生态的关系

### 12.1 兼容性矩阵

| 生态组件 | 关系 | 说明 |
|---------|------|------|
| **Agent Skills Spec** | 完全兼容 | `SKILL.md` 标准格式，扩展在 `metadata` 下 |
| **ClawhHub** | 可选发布 | 可同步发布到 ClawhHub，扩大社区覆盖 |
| **OpenClaw** | 底层运行时 | ClawX 内嵌 OpenClaw，Skills 在其上运行 |
| **ClawX** | 预装分发 | 作为 ClawX 的金融行业解决方案层 |
| **clawhub CLI** | 兼容 | 用户也可通过 `clawhub install` 安装 |

### 12.2 与 anthropics/financial-services-plugins 的差异定位

| 维度 | Anthropic FSP | 我们 |
|------|-------------|------|
| 目标市场 | 美国/欧洲投行 | 中国机构买方 → 亚洲 |
| 数据源 | Morningstar/S&P/FactSet | Wind/iFind/东方财富 → Bloomberg |
| 运行模式 | 单次对话 | 7×24h 长周期 |
| 能力粒度 | 高层工作流 (41 skills) | 原子能力 (38→100+ skills) |
| 分发 | Claude 插件市场 | ClawX 桌面预装 |
| 审核 | GitHub PR | 专家 + 回测验证 |
| 编排 | 无 | Pipeline YAML |
| 调度 | 无 | Cron + Daemon + 交易日历 |

两者可以互补：我们覆盖中国市场，他们覆盖欧美市场。远期可探索互操作。

---

## 附录 A: registry.json Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "version": { "type": "string" },
    "generated_at": { "type": "string", "format": "date-time" },
    "skills_count": { "type": "integer" },
    "skills": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "slug": { "type": "string" },
          "version": { "type": "string" },
          "layer": { "enum": ["data", "tool", "indicator", "backtest", "model", "monitor", "report", "compliance"] },
          "run_mode": { "enum": ["oneshot", "daemon", "cron"] },
          "markets": { "type": "array", "items": { "type": "string" } },
          "assets": { "type": "array", "items": { "type": "string" } },
          "roles": { "type": "array", "items": { "type": "string" } },
          "quality_level": { "enum": ["verified", "reviewed", "community"] },
          "display_name_zh": { "type": "string" },
          "display_name_en": { "type": "string" },
          "description": { "type": "string" },
          "sha256": { "type": "string" }
        },
        "required": ["slug", "version", "layer", "run_mode", "markets", "assets"]
      }
    },
    "bundles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name_zh": { "type": "string" },
          "name_en": { "type": "string" },
          "description_zh": { "type": "string" },
          "skills": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
```

## 附录 B: Pipeline YAML Schema

```yaml
# 完整的 Pipeline 定义
name: string                      # Pipeline 名称
description: string               # 描述
schedule:                         # 调度配置
  cron: string                    # cron 表达式
  timezone: string                # IANA 时区
  market_calendar: string?        # 交易日历 ID
  skip_holidays: boolean?         # 跳过节假日
  enabled: boolean                # 是否启用

params:                           # 全局参数
  key: value

steps:
  - id: string                    # 步骤 ID
    skill: string                 # Skill slug
    params: object                # 传递给 Skill 的参数
    depends_on: string[]?         # 依赖的前置步骤
    parallel_with: string?        # 并行执行的步骤
    timeout: string               # 超时 (如 "120s")
    retry:                        # 重试策略
      max_attempts: integer
      backoff: exponential | linear
    on_failure: retry | alert | skip | abort

  - id: string
    action: notify                # 内置动作 (非 Skill)
    depends_on: string[]
    channels: string[]
    recipients: string
```
