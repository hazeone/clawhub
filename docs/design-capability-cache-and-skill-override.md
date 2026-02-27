# 数据源能力缓存 & Skill 用户修改方案

> v0.1 · 2026-02-27
> 对应两个核心问题：
> 1. 如何缓存"用户有 Wind"，以及状态变更管理
> 2. 用户修改 Skill 后的版本兼容性处理

---

## 目录

1. [问题 1: 数据源能力缓存](#问题-1-数据源能力缓存)
   - [1.1 问题拆解](#11-问题拆解)
   - [1.2 现有系统盘点](#12-现有系统盘点)
   - [1.3 方案设计: Capability Profile](#13-方案设计-capability-profile)
   - [1.4 检测策略](#14-检测策略)
   - [1.5 状态变更管理](#15-状态变更管理)
   - [1.6 Skill 运行时如何消费](#16-skill-运行时如何消费)
2. [问题 2: Skill 用户修改与版本兼容](#问题-2-skill-用户修改与版本兼容)
   - [2.1 问题拆解](#21-问题拆解)
   - [2.2 现有系统盘点](#22-现有系统盘点)
   - [2.3 方案设计: 三层覆盖模型](#23-方案设计-三层覆盖模型)
   - [2.4 修改分级与处理策略](#24-修改分级与处理策略)
   - [2.5 版本兼容与升级合并](#25-版本兼容与升级合并)
   - [2.6 冲突解决流程](#26-冲突解决流程)
3. [实现方案](#实现方案)

---

## 问题 1: 数据源能力缓存

### 1.1 问题拆解

"缓存用户有 Wind" 不是一个简单的布尔开关，而是一系列分层问题：

```
Q1: 用户的机器上有没有 Wind 终端？             → 环境检测
Q2: Wind 终端当前是否在运行（已登录）？          → 运行时探测
Q3: 用户的 Wind 账号有哪些数据权限？             → 权限探测
Q4: 检测结果存在哪里？                          → 持久化
Q5: Wind 到期/卸载/升级了怎么办？               → 状态变更
Q6: Skill 运行时怎么知道这些信息？              → 消费机制
```

### 1.2 现有系统盘点

ClawX/OpenClaw 已有的状态管理机制：

| 存储位置 | 内容 | 持久性 | 读写方 |
|---------|------|--------|--------|
| `<userData>/settings.json` | 应用设置 (electron-store) | 持久 | Main process |
| `<userData>/clawx-providers.json` | AI Provider 配置 + API Keys | 持久 | Main process |
| `~/.openclaw/openclaw.json` | OpenClaw 主配置 (channels, skills, models) | 持久 | Gateway + Main |
| `~/.openclaw/skills/<slug>/` | 已安装 Skill 文件 | 持久 | CLI + Gateway |
| `~/.openclaw/.clawhub/lock.json` | 安装锁 | 持久 | CLI |
| Gateway RPC `skills.status` | 运行中 Skill 状态 | 内存 | Gateway → Renderer |
| Zustand + localStorage | UI 状态 | 持久(前端) | Renderer |

**关键发现**：没有一个地方专门管理"用户环境能力"。Provider 配置只管 AI 模型，
Skill 配置只管 enable/disable + env vars。缺少一个 **Capability Profile** 层。

### 1.3 方案设计: Capability Profile

引入一个新的持久化层 —— **Capability Profile**，统一管理所有数据源/工具的可用性状态。

#### 文件位置与格式

```
~/.openclaw/clawx-capabilities.json
```

```jsonc
{
  "version": 1,
  "updated_at": "2026-02-27T08:30:00.000Z",

  // 数据源能力
  "data_sources": {
    "wind": {
      "status": "available",          // available | unavailable | degraded | unchecked
      "detected_at": "2026-02-27T08:30:00.000Z",
      "last_checked_at": "2026-02-27T08:30:00.000Z",
      "check_method": "process+api",  // 怎么检测到的
      "details": {
        "install_path": "C:\\Wind\\Wind.NET\\WindNET",
        "version": "2025.12.1",
        "api_type": "windpy",         // windpy | rest | both
        "permissions": {              // 探测到的数据权限
          "cn_a_equity": true,
          "cn_a_bond": true,
          "cn_a_fund": true,
          "hk_equity": true,
          "us_equity": false,         // 无美股权限
          "financial_statements": true,
          "realtime_quote": true,
          "historical_data": true
        },
        "account_expiry": "2027-03-15",  // Wind 账号到期日
        "python_package": {
          "installed": true,
          "version": "1.8.2",
          "path": "/usr/local/lib/python3.12/site-packages/WindPy"
        }
      },
      "user_override": null           // 用户手动覆盖 (见 1.5)
    },

    "ifind": {
      "status": "unavailable",
      "detected_at": "2026-02-27T08:30:00.000Z",
      "last_checked_at": "2026-02-27T08:30:00.000Z",
      "check_method": "process",
      "details": null,
      "user_override": null
    },

    "bloomberg": {
      "status": "unchecked",
      "detected_at": null,
      "last_checked_at": null,
      "check_method": null,
      "details": null,
      "user_override": null
    },

    "tushare": {
      "status": "available",
      "detected_at": "2026-02-27T08:25:00.000Z",
      "last_checked_at": "2026-02-27T08:25:00.000Z",
      "check_method": "api_key",
      "details": {
        "api_type": "rest",
        "token_set": true,             // 不存实际 token
        "tier": "pro"                  // 免费版/pro
      },
      "user_override": null
    }
  },

  // 工具能力
  "tools": {
    "python3": {
      "status": "available",
      "version": "3.12.3",
      "path": "/usr/bin/python3"
    },
    "excel": {
      "status": "available",
      "version": "Microsoft 365",
      "path": null
    }
  },

  // MCP 连接器状态
  "mcp_connectors": {
    "wind": {
      "status": "available",
      "url": null,                     // stdio 模式无 URL
      "last_health_check": "2026-02-27T08:30:00.000Z"
    }
  }
}
```

#### 为什么是独立文件而非放在 settings.json

| 考量 | 决策 |
|------|------|
| 读写频率 | 能力检测频繁更新，不应干扰用户设置 |
| 数据量 | 权限详情可能很大 |
| 生命周期 | 跨 ClawX 版本持久，但可安全删除重建 |
| 访问者 | Main process + Gateway + Agent 都需要读取 |
| 敏感度 | 不含凭据（API Keys 仍在 providers.json） |

### 1.4 检测策略

#### 检测时机矩阵

| 时机 | 触发条件 | 检测范围 | 用户感知 |
|------|---------|---------|---------|
| **首次启动** | ClawX 安装后首次运行 | 全量扫描 | Setup Wizard 中展示 |
| **每日启动** | 每天首次打开 ClawX | 增量检测（仅 `available` 和 `degraded`） | 后台静默 |
| **Skill 触发** | Skill 声明需要某数据源但状态为 `unchecked` | 单项检测 | 对话中通知 |
| **手动触发** | 用户点击"重新检测" | 全量或单项 | 进度展示 |
| **定时巡检** | Cron，每 4 小时 | 仅 `available` 项验活 | 完全静默 |

#### 各数据源检测方法

**Wind 终端**：

```typescript
async function detectWind(): Promise<CapabilityResult> {
  const checks = {
    // Step 1: 进程检测 — Wind 终端是否在运行
    processRunning: await checkProcess(['WindNET', 'Wind.exe', 'WFT']),

    // Step 2: 安装路径探测
    installPath: await probeInstallPaths([
      'C:\\Wind\\Wind.NET',
      'C:\\WindSoft',
      process.env.WIND_HOME,
    ]),

    // Step 3: Python 包检测
    pythonPackage: await checkPythonImport('WindPy', `
      from WindPy import w
      w.start()
      data = w.wsd("000001.SH", "close", "2026-02-26", "2026-02-26")
      print("OK" if data.ErrorCode == 0 else f"ERR:{data.ErrorCode}")
      w.stop()
    `),

    // Step 4: 权限探测 (仅当 Step 3 通过)
    permissions: null as Record<string, boolean> | null,
  };

  if (checks.pythonPackage.available) {
    checks.permissions = await probeWindPermissions();
  }

  return buildCapabilityResult('wind', checks);
}
```

**Wind 权限探测** — 通过尝试拉取各类数据判断权限：

```typescript
async function probeWindPermissions(): Promise<Record<string, boolean>> {
  const probes = [
    { key: 'cn_a_equity',        code: 'w.wsd("000001.SH","close","2026-02-26","2026-02-26")' },
    { key: 'cn_a_bond',          code: 'w.wsd("019601.SH","close","2026-02-26","2026-02-26")' },
    { key: 'cn_a_fund',          code: 'w.wsd("510050.SH","close","2026-02-26","2026-02-26")' },
    { key: 'hk_equity',          code: 'w.wsd("00700.HK","close","2026-02-26","2026-02-26")' },
    { key: 'us_equity',          code: 'w.wsd("AAPL.O","close","2026-02-26","2026-02-26")' },
    { key: 'financial_statements', code: 'w.wss("000001.SZ","roe_ttm")' },
    { key: 'realtime_quote',     code: 'w.wsq("000001.SZ","rt_last")' },
  ];

  const results: Record<string, boolean> = {};
  for (const probe of probes) {
    results[probe.key] = await runWindProbe(probe.code);
  }
  return results;
}
```

**iFind 终端**：

```typescript
async function detectIfind(): Promise<CapabilityResult> {
  return {
    processRunning: await checkProcess(['iFinDClient', 'THS']),
    installPath: await probeInstallPaths([
      'C:\\iFinD',
      'C:\\同花顺iFinD',
      process.env.IFIND_HOME,
    ]),
    pythonPackage: await checkPythonImport('iFinDPy', `
      from iFinDPy import *
      ret = THS_iFinDLogin("test", "test")
      print("INSTALLED")
    `),
  };
}
```

**Tushare / AKShare（纯 API 类）**：

```typescript
async function detectTushare(): Promise<CapabilityResult> {
  // 仅检查：(1) Python 包是否安装 (2) Token 是否配置
  const pkg = await checkPythonImport('tushare', 'import tushare; print(tushare.__version__)');
  const tokenSet = !!process.env.TUSHARE_TOKEN ||
    await checkFileContains('~/.openclaw/openclaw.json', 'TUSHARE_TOKEN');

  return { pythonPackage: pkg, tokenConfigured: tokenSet };
}
```

**Bloomberg**：

```typescript
async function detectBloomberg(): Promise<CapabilityResult> {
  return {
    processRunning: await checkProcess(['bbcomm', 'blpapi']),
    pythonPackage: await checkPythonImport('blpapi', 'import blpapi; print(blpapi.VERSION_MAJOR)'),
    // Bloomberg 权限探测成本高，仅检测连接性
    connectivity: await checkBloombergConnect(),
  };
}
```

### 1.5 状态变更管理

#### 状态机

```
                 ┌──────────────┐
   首次启动 ───▶ │  unchecked   │
                 └──────┬───────┘
                        │ 检测
                 ┌──────┴───────┐
          ┌──────┤              ├──────┐
          ▼      │              │      ▼
  ┌──────────┐   │              │  ┌─────────────┐
  │ available │   │              │  │ unavailable │
  └─────┬────┘   │              │  └──────┬──────┘
        │        │              │         │
        │ 巡检失败│              │ 重新检测 │
        ▼        │              │         ▼
  ┌──────────┐   │              │  ┌─────────────┐
  │ degraded │◀──┘              └──│  available   │
  └──────────┘                     └─────────────┘
        │
        │ 连续3次巡检失败
        ▼
  ┌─────────────┐
  │ unavailable │
  └─────────────┘
```

**状态定义**：

| 状态 | 含义 | Skill 行为 |
|------|------|-----------|
| `unchecked` | 从未检测 | 触发按需检测 |
| `available` | 已确认可用，权限已知 | 正常使用 |
| `degraded` | 之前可用，最近一次巡检异常 | 降级：尝试使用，但准备 fallback |
| `unavailable` | 确认不可用 | 自动切换到替代数据源 |

#### 变更事件

```typescript
type CapabilityChangeEvent = {
  source: string;             // "wind" | "ifind" | ...
  previous_status: CapabilityStatus;
  new_status: CapabilityStatus;
  reason: string;             // "process_exited" | "license_expired" | "api_error" | "user_override"
  detected_at: string;
  permissions_changed?: {     // 权限级别变化
    added: string[];
    removed: string[];
  };
};
```

#### 变更通知链

```
检测模块 ──▶ 写入 clawx-capabilities.json
         ──▶ 发射 IPC 事件: capability-changed
              │
              ├──▶ Main Process: 更新 Gateway 环境变量
              ├──▶ Renderer: Toast 通知用户
              └──▶ Gateway: 通知运行中的 Daemon Skills
```

**关键场景处理**：

| 场景 | 检测方式 | 处理 |
|------|---------|------|
| Wind 终端关闭 | 进程巡检 (每4h) | `available` → `degraded`，通知用户 |
| Wind 账号到期 | API 调用返回权限错误 | `available` → `degraded`，附原因 |
| Wind 终端重新打开 | 下次巡检 | `degraded` → `available` |
| 用户卸载 Wind | 启动检测 | `available` → `unavailable` |
| 用户新安装 Wind | 手动"重新检测" | `unchecked` → `available` |
| Wind 权限升级（加了美股） | 定时权限重探 | 更新 permissions，通知 Skill |

#### 用户手动覆盖

用户可能知道检测不到的能力（如 Wind REST API 在远程服务器上）：

```jsonc
// clawx-capabilities.json 中
"wind": {
  "status": "unavailable",      // 自动检测结果
  "user_override": {
    "status": "available",       // 用户手动标记可用
    "reason": "Remote Wind REST API at internal server",
    "set_at": "2026-02-27T10:00:00.000Z",
    "api_endpoint": "https://wind-api.internal.corp:8080"
  }
}
```

**生效优先级**：`user_override > 自动检测`

ClawX Settings 中提供 UI：

```
数据源配置
├── Wind 金融终端
│   ├── 状态: ✅ 可用 (自动检测, 上次检查: 10分钟前)
│   ├── [重新检测]
│   ├── 权限: A股 ✅ | 港股 ✅ | 美股 ❌ | 债券 ✅ | 基金 ✅
│   ├── 账号到期: 2027-03-15
│   └── [手动覆盖状态 ▼]
│
├── iFind 同花顺
│   ├── 状态: ❌ 未检测到
│   └── [手动标记为可用]  ← 点击后弹出配置对话框
│
├── Tushare
│   ├── 状态: ⚠️ 已安装但未配置 Token
│   └── [配置 Token]
│
└── Bloomberg
    ├── 状态: ⚠️ 降级 (终端进程未运行)
    └── [重新检测]
```

### 1.6 Skill 运行时如何消费

#### Skill 侧声明

在 SKILL.md frontmatter 中声明数据源需求和 fallback 策略：

```yaml
metadata:
  clawx-finance:
    requires:
      mcp: [wind]                    # 首选 MCP 连接器
    data_source_policy:
      primary: wind                  # 首选数据源
      fallback:                      # 降级策略
        - source: tushare
          covers: [cn_a_equity, historical_data]  # Tushare 能覆盖的能力
        - source: akshare
          covers: [cn_a_equity, historical_data]  # AKShare 也行
      required_permissions:          # 此 Skill 必须的权限
        - cn_a_equity
        - historical_data
```

#### 运行时注入

Agent 会话启动时，将能力状态注入到系统 prompt 上下文中：

```xml
<capability_context>
  <data_sources>
    <source name="wind" status="available">
      <permissions>cn_a_equity, cn_a_bond, cn_a_fund, hk_equity, financial_statements, realtime_quote, historical_data</permissions>
      <api_type>windpy</api_type>
    </source>
    <source name="tushare" status="available">
      <tier>pro</tier>
    </source>
    <source name="bloomberg" status="unavailable" />
  </data_sources>
  <tools>
    <tool name="python3" version="3.12.3" />
    <tool name="excel" version="Microsoft 365" />
  </tools>
</capability_context>
```

这样 Skill 在执行时可以智能选择：

```markdown
## 数据获取策略

当需要获取 A 股行情数据时，按以下优先级选择数据源：

1. **Wind 可用** → 使用 `w.wsd()` 获取，数据最全最准
2. **Wind 不可用但 Tushare 可用** → 使用 `ts.pro_bar()` 获取，覆盖基础行情
3. **都不可用** → 使用 AKShare 公开接口，注意频率限制

检查方式：读取 `<capability_context>` 中的 data_sources 状态。
```

---

## 问题 2: Skill 用户修改与版本兼容

### 2.1 问题拆解

```
Q1: 用户为什么要修改 Skill？              → 动机分类
Q2: 修改发生在哪里？                      → 文件层面
Q3: 下次上游更新时，用户修改怎么办？       → 合并策略
Q4: 如何知道哪些是用户改的？              → 变更追踪
Q5: 改坏了怎么回退？                     → 回滚机制
Q6: 好的修改能不能贡献回来？              → 反馈通道
```

### 2.2 现有系统盘点

ClawhHub/OpenClaw 已有的相关机制：

| 机制 | 工作方式 | 局限 |
|------|---------|------|
| **origin.json** | 记录安装来源 (registry, slug, version) | 只记录了"从哪来"，不记录"改了什么" |
| **指纹 (fingerprint)** | SHA256(文件路径:文件哈希) | 能检测到"有改动"，但不知道改了哪里 |
| **sync 命令** | 指纹比对 → 发现差异 → 提示上传 | 面向发布者，非消费者 |
| **forkOf** | 记录 fork 关系 | 发布后不可变，不支持增量合并 |
| **Skill 目录优先级** | workspace > managed > bundled | 覆盖而非合并，升级时全量替换 |

**核心缺失**：
- 没有 **基线快照**（用户拿到的原始版本副本）
- 没有 **diff 机制**（用户改了什么）
- 没有 **合并策略**（上游更新时如何保留用户修改）

### 2.3 方案设计: 三层覆盖模型

```
优先级 (高→低):

┌─────────────────────────────────────────────┐
│  Layer 3: User Overrides (用户覆盖层)        │  ~/.openclaw/financial-skills/<slug>/
│  用户直接修改的文件，最高优先级              │  可写，用户拥有
├─────────────────────────────────────────────┤
│  Layer 2: Managed Updates (托管更新层)        │  ~/.openclaw/financial-skills/.managed/<slug>/
│  热更新下载的最新版本                        │  只读(对用户)，自动更新
├─────────────────────────────────────────────┤
│  Layer 1: Bundled Baseline (预装基线层)       │  <app>/resources/bundled-skills/<slug>/
│  随 ClawX 安装包分发的版本                   │  只读，随 app 更新
└─────────────────────────────────────────────┘
```

**解析规则**：逐层查找文件，高层覆盖低层。

```typescript
class SkillResolver {
  /**
   * 解析 Skill 的最终有效文件集。
   * 不是简单的目录优先级——而是文件级合并。
   */
  async resolveSkillFiles(slug: string): Promise<ResolvedSkill> {
    const layers = [
      { name: 'bundled',  dir: path.join(this.bundledDir, slug),  writable: false },
      { name: 'managed',  dir: path.join(this.managedDir, slug),  writable: false },
      { name: 'user',     dir: path.join(this.userDir, slug),     writable: true  },
    ];

    const fileMap = new Map<string, { content: string; source: LayerName }>();

    for (const layer of layers) {
      if (!fs.existsSync(layer.dir)) continue;
      const files = await listTextFiles(layer.dir);
      for (const file of files) {
        fileMap.set(file.relPath, {
          content: file.bytes.toString(),
          source: layer.name,
        });
      }
    }

    return {
      slug,
      files: fileMap,
      hasUserOverrides: [...fileMap.values()].some(f => f.source === 'user'),
      effectiveVersion: await this.resolveEffectiveVersion(slug, layers),
    };
  }
}
```

### 2.4 修改分级与处理策略

用户对 Skill 的修改分为四个级别，每个级别处理方式不同：

#### Level 0: 参数调整 — 不改文件

用户只是调整 Skill 的运行参数（阈值、时间窗口、基准指数等），不修改 SKILL.md。

```jsonc
// ~/.openclaw/financial-skills/.config/<slug>.json
{
  "version": 1,
  "skill_slug": "indicator-return-metrics",
  "base_version": "1.0.0",            // 对应哪个版本的默认参数
  "params": {
    "risk_free_rate": 0.025,           // 覆盖默认的 2.1%
    "default_window": 120,             // 覆盖默认的 252
    "default_benchmark": "000905.SH",  // 改用中证500
    "annualization_factor": 252
  },
  "updated_at": "2026-02-27T10:00:00.000Z"
}
```

**处理策略**：
- 参数配置独立于 Skill 文件，上游更新**不影响**用户参数
- Skill 新版本新增参数时，使用新版本默认值（用户未覆盖的参数）
- UI 提供参数编辑面板，无需手动改文件

#### Level 1: 轻度定制 — 改 SKILL.md 局部内容

用户修改了 SKILL.md 的一部分（如调整触发关键词、补充行业术语、修正公式）。

**处理策略**：基线快照 + 三向合并

```
初始安装时:
  bundled/indicator-return-metrics/SKILL.md  →  .baseline/indicator-return-metrics/SKILL.md
                                                (存一份原始副本作为合并基线)

用户修改后:
  user/indicator-return-metrics/SKILL.md     ←  用户编辑后的版本

上游更新时:
  managed/indicator-return-metrics/SKILL.md  ←  新版本 (热更新下载)

  三向合并:
    base    = .baseline/indicator-return-metrics/SKILL.md  (安装时的快照)
    theirs  = managed/indicator-return-metrics/SKILL.md    (上游新版)
    ours    = user/indicator-return-metrics/SKILL.md       (用户修改版)
    result  = three_way_merge(base, theirs, ours)
```

#### Level 2: 结构性修改 — 新增/删除文件

用户新增了脚本、参考文档，或删除了不需要的部分。

**处理策略**：文件级合并

```
文件合并规则:
  base 有, theirs 有, ours 有    → 三向合并文件内容
  base 有, theirs 有, ours 无    → 用户删除，保持删除
  base 有, theirs 无, ours 有    → 上游删除，提示用户确认
  base 有, theirs 无, ours 无    → 双方都删了，删除
  base 无, theirs 有, ours 无    → 上游新增，加入
  base 无, theirs 无, ours 有    → 用户新增，保留
  base 无, theirs 有, ours 有    → 冲突（不太可能），提示用户
```

#### Level 3: 完全重写 — 替换整个 Skill

用户几乎重写了整个 SKILL.md（相似度 < 30%）。

**处理策略**：视为 fork，不再自动合并

```typescript
function classifyModification(baseline: string, userVersion: string): ModLevel {
  const similarity = computeSimilarity(baseline, userVersion);

  if (similarity > 0.9) return 'level-0';  // 几乎没改
  if (similarity > 0.6) return 'level-1';  // 轻度定制
  if (similarity > 0.3) return 'level-2';  // 结构性修改
  return 'level-3';                         // 完全重写
}
```

Level 3 时：
- 标记为 `forked`，上游更新**不自动合并**
- 通知用户："此 Skill 已大幅修改，上游有新版本，是否查看变更？"
- 用户可选择：保持自己的版本 / 查看 diff / 重置为上游版本

### 2.5 版本兼容与升级合并

#### 版本追踪文件

每个用户修改的 Skill 维护一个元数据文件：

```jsonc
// ~/.openclaw/financial-skills/.meta/<slug>.json
{
  "version": 1,
  "slug": "indicator-return-metrics",
  "installed_version": "1.0.0",        // 安装/最后同步时的上游版本
  "current_upstream": "1.2.0",         // 最新可用的上游版本
  "modification_level": "level-1",     // 自动评估的修改级别
  "user_modified": true,
  "user_modified_at": "2026-02-27T10:00:00.000Z",
  "files_modified": [                  // 用户修改了哪些文件
    "SKILL.md"
  ],
  "files_added": [                     // 用户新增了哪些文件
    "references/my_custom_benchmarks.md"
  ],
  "files_deleted": [],                 // 用户删除了哪些文件
  "last_merge_result": null,           // 最近一次合并结果
  "forked": false                      // 是否已标记为 fork
}
```

#### 升级流程

```
                     上游发布新版本 (1.0.0 → 1.2.0)
                              │
                              ▼
                    ┌─────────────────────┐
                    │  用户是否修改过此Skill? │
                    └──────────┬──────────┘
                         ┌─────┴─────┐
                     未修改         已修改
                         │           │
                         ▼           ▼
                 ┌──────────┐  ┌──────────────┐
                 │ 直接替换  │  │ 评估修改级别  │
                 │ (静默更新) │  │              │
                 └──────────┘  └──────┬───────┘
                                      │
                       ┌──────────────┼──────────────┐
                       ▼              ▼              ▼
                 ┌──────────┐  ┌──────────┐  ┌──────────────┐
                 │ Level 0-1│  │ Level 2  │  │  Level 3     │
                 │ 自动合并  │  │ 文件合并  │  │  通知用户    │
                 │          │  │ +用户确认  │  │  不自动合并   │
                 └────┬─────┘  └────┬─────┘  └──────────────┘
                      │             │
                      ▼             ▼
               ┌─────────────────────────┐
               │   合并成功？             │
               └────────┬────────────────┘
                   ┌────┴────┐
                 成功      有冲突
                   │         │
                   ▼         ▼
            ┌──────────┐ ┌────────────┐
            │ 更新基线  │ │ 写 .conflict│
            │ 写入user层│ │ 文件，让用户│
            │ 通知完成  │ │ 手动解决    │
            └──────────┘ └────────────┘
```

#### 自动合并实现

使用结构化三向合并，而非文本行级 diff（因为 SKILL.md 是结构化的 Markdown）：

```typescript
interface MergeResult {
  status: 'clean' | 'conflict' | 'skipped';
  merged_content?: string;
  conflicts?: ConflictRegion[];
  stats: {
    sections_unchanged: number;
    sections_merged: number;
    sections_conflicted: number;
  };
}

async function mergeSkillFile(
  basePath: string,     // .baseline 中的原始版本
  theirsPath: string,   // .managed 中的上游新版
  oursPath: string,     // user 层中用户修改版
): Promise<MergeResult> {
  const base = parseSKILLmd(await readFile(basePath, 'utf-8'));
  const theirs = parseSKILLmd(await readFile(theirsPath, 'utf-8'));
  const ours = parseSKILLmd(await readFile(oursPath, 'utf-8'));

  const mergedFrontmatter = mergeFrontmatter(base.frontmatter, theirs.frontmatter, ours.frontmatter);
  const mergedSections = mergeSections(base.sections, theirs.sections, ours.sections);

  return assembleMergeResult(mergedFrontmatter, mergedSections);
}

function mergeFrontmatter(base: FM, theirs: FM, ours: FM): FM {
  const result = { ...theirs };  // 上游为基础

  for (const [key, value] of Object.entries(ours)) {
    const baseValue = base[key];
    const theirsValue = theirs[key];

    if (deepEqual(baseValue, value)) {
      // 用户没改这个字段 → 用上游的
      continue;
    }
    if (deepEqual(baseValue, theirsValue)) {
      // 上游没改这个字段 → 用用户的
      result[key] = value;
      continue;
    }
    // 双方都改了 → 取决于字段类型
    if (key === 'version') {
      result[key] = theirsValue;  // 版本号以上游为准
    } else if (key === 'description') {
      result[key] = value;  // 描述以用户为准
    } else {
      result[key] = value;  // 默认用户优先
      // 记录冲突供用户审核
    }
  }
  return result;
}

function mergeSections(
  baseSections: Section[],
  theirsSections: Section[],
  oursSections: Section[],
): MergedSection[] {
  // 按标题匹配 sections
  // 使用 heading 作为 section identity
  const baseMap = new Map(baseSections.map(s => [s.heading, s]));
  const theirsMap = new Map(theirsSections.map(s => [s.heading, s]));
  const oursMap = new Map(oursSections.map(s => [s.heading, s]));

  const allHeadings = new Set([
    ...baseMap.keys(),
    ...theirsMap.keys(),
    ...oursMap.keys(),
  ]);

  const merged: MergedSection[] = [];

  for (const heading of allHeadings) {
    const b = baseMap.get(heading);
    const t = theirsMap.get(heading);
    const o = oursMap.get(heading);

    if (b && t && o) {
      // 三方都有这个 section
      if (b.content === o.content) {
        // 用户没改 → 用上游
        merged.push({ heading, content: t.content, source: 'theirs' });
      } else if (b.content === t.content) {
        // 上游没改 → 用用户
        merged.push({ heading, content: o.content, source: 'ours' });
      } else {
        // 都改了 → 行级合并或标记冲突
        merged.push(lineBasedMerge(heading, b.content, t.content, o.content));
      }
    } else if (!b && t && !o) {
      // 上游新增 section → 加入
      merged.push({ heading, content: t.content, source: 'theirs-new' });
    } else if (!b && !t && o) {
      // 用户新增 section → 保留
      merged.push({ heading, content: o.content, source: 'ours-new' });
    }
    // ... 其他组合
  }

  return merged;
}
```

### 2.6 冲突解决流程

#### 冲突文件格式

当自动合并遇到冲突，生成 `.conflict` 标记文件：

```
~/.openclaw/financial-skills/<slug>/
├── SKILL.md                 ← 合并后的版本 (冲突区域用标记标出)
├── SKILL.md.conflict        ← 冲突详情
└── .meta/
    └── merge-pending.json   ← 待解决的合并状态
```

`SKILL.md.conflict` 内容：

```markdown
# 合并冲突报告
- Skill: indicator-return-metrics
- 基线版本: 1.0.0
- 上游版本: 1.2.0
- 冲突数量: 2

## 冲突 1: "## 无风险利率选择" section

### 上游版本 (1.2.0 新增了 LPR 选项):
```
| 期限 | 基准利率 | 数据源 |
|------|---------|--------|
| 短期 | Shibor 3M | Wind: M0017142 |
| 中期 | 中债国债 3Y | Wind: M0325687 |
| 长期 | 中债国债 10Y | Wind: M0325689 |
| **LPR** | **1Y LPR** | **Wind: M1001622** |
```

### 你的版本 (自定义了默认利率):
```
| 期限 | 基准利率 | 数据源 |
|------|---------|--------|
| 默认 | 中债国债 1Y (2.5%) | Wind: M0017142 |
```

### 建议操作:
保留上游的完整表格，并加入你自定义的默认值行。
```

#### ClawX UI 冲突解决

```
┌──────────────────────────────────────────────┐
│  ⚠️ Skill 更新冲突                            │
│                                              │
│  indicator-return-metrics 有新版本 (1.2.0)，  │
│  但你有本地修改，自动合并遇到 2 处冲突。       │
│                                              │
│  ┌─────────────────────────────────────────┐  │
│  │  冲突 1/2: 无风险利率选择                │  │
│  │                                         │  │
│  │  ┌──────────┐  ┌──────────┐             │  │
│  │  │ 上游版本  │  │ 你的版本  │             │  │
│  │  │ (新增LPR) │  │ (自定义)  │             │  │
│  │  └──────────┘  └──────────┘             │  │
│  │                                         │  │
│  │  [保留我的] [使用上游] [手动编辑]         │  │
│  └─────────────────────────────────────────┘  │
│                                              │
│  [跳过此次更新]  [全部使用上游]  [全部保留我的] │
└──────────────────────────────────────────────┘
```

#### 回滚机制

```typescript
async function rollbackSkill(slug: string, target: 'baseline' | 'managed' | 'version') {
  const meta = await readSkillMeta(slug);
  const userDir = path.join(USER_SKILLS_DIR, slug);

  switch (target) {
    case 'baseline':
      // 回滚到安装时的版本
      await copyDir(path.join(BASELINE_DIR, slug), userDir);
      meta.user_modified = false;
      meta.modification_level = 'level-0';
      break;

    case 'managed':
      // 重置为最新上游版本（放弃所有用户修改）
      await removeDir(userDir);
      meta.user_modified = false;
      meta.installed_version = meta.current_upstream;
      break;

    case 'version':
      // 回滚到特定历史版本 (从 .history/ 恢复)
      // ...
      break;
  }

  await writeSkillMeta(slug, meta);
}
```

#### 修改历史快照

每次用户保存修改时，自动创建快照：

```
~/.openclaw/financial-skills/.history/<slug>/
├── 2026-02-27T08-30-00/           ← 时间戳目录
│   ├── SKILL.md
│   └── .snapshot.json             ← { reason: "user_edit", base_version: "1.0.0" }
├── 2026-02-27T14-15-00/
│   ├── SKILL.md
│   └── .snapshot.json             ← { reason: "merge_1.2.0", base_version: "1.2.0" }
└── ...
```

保留策略：最近 10 个快照 + 每个上游版本合并点各保留 1 个。

---

## 实现方案

### 目录结构扩展

```
~/.openclaw/
├── openclaw.json                           # OpenClaw 主配置 (已有)
├── clawx-capabilities.json                 # [新增] Capability Profile
├── skills/                                 # ClawhHub 社区 Skills (已有)
│
└── financial-skills/                       # [新增] 金融 Skills 专用根目录
    ├── .managed/                           #   托管更新层 (热更新下载)
    │   └── <slug>/SKILL.md
    ├── .baseline/                          #   基线快照层 (安装时原始副本)
    │   └── <slug>/SKILL.md
    ├── .config/                            #   用户参数配置 (Level 0)
    │   └── <slug>.json
    ├── .meta/                              #   Skill 元数据 (追踪修改状态)
    │   └── <slug>.json
    ├── .history/                           #   修改历史快照
    │   └── <slug>/
    │       └── <timestamp>/
    │
    └── <slug>/                             #   用户覆盖层 (Level 1-3 修改)
        ├── SKILL.md                        #   用户修改后的版本
        └── references/
            └── my_custom_stuff.md          #   用户新增的文件
```

### Skill 加载优先级（最终）

```typescript
const SKILL_LOAD_ORDER = [
  // 1. 用户覆盖 (最高)
  '~/.openclaw/financial-skills/<slug>/',

  // 2. 托管更新 (热更新下载的新版)
  '~/.openclaw/financial-skills/.managed/<slug>/',

  // 3. 预装基线 (随 ClawX app 分发)
  '<app>/resources/bundled-skills/<slug>/',

  // 4. ClawhHub 社区 (可选安装)
  '~/.openclaw/skills/<slug>/',
];
```

### 接口设计

```typescript
interface FinancialSkillsService {
  // === Capability Profile ===
  getCapabilities(): Promise<CapabilityProfile>;
  detectCapability(source: string): Promise<CapabilityResult>;
  detectAllCapabilities(): Promise<CapabilityProfile>;
  setCapabilityOverride(source: string, override: UserOverride | null): Promise<void>;
  onCapabilityChanged(cb: (event: CapabilityChangeEvent) => void): Unsubscribe;

  // === Skill Resolution ===
  resolveSkill(slug: string): Promise<ResolvedSkill>;
  listSkills(): Promise<SkillInfo[]>;

  // === User Modifications ===
  getSkillMeta(slug: string): Promise<SkillMeta>;
  saveUserOverride(slug: string, files: Map<string, string>): Promise<void>;
  getSkillConfig(slug: string): Promise<SkillConfig>;
  setSkillConfig(slug: string, params: Record<string, unknown>): Promise<void>;

  // === Version Management ===
  checkUpstreamUpdates(): Promise<UpdateCheckResult[]>;
  applyUpdate(slug: string): Promise<MergeResult>;
  resolveConflict(slug: string, resolutions: ConflictResolution[]): Promise<void>;
  rollbackSkill(slug: string, target: RollbackTarget): Promise<void>;
  getModificationHistory(slug: string): Promise<Snapshot[]>;
}
```
