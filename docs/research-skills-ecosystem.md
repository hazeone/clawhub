# Skills 生态系统调研报告

> 调研日期：2026-02-27

---

## 目录

1. [ClawhHub Skills 更新维护机制](#1-clawhub-skills-更新维护机制)
2. [OpenClaw 产品接入方式](#2-openclaw-产品接入方式)
3. [与 anthropics/financial-services-plugins 的技术异同](#3-与-anthropicsfinancial-services-plugins-的技术异同)
4. [高星 GitHub Skills 项目对比](#4-高星-github-skills-项目对比)
5. [总结与建议](#5-总结与建议)

---

## 1. ClawhHub Skills 更新维护机制

### 1.1 整体架构

ClawhHub 是一个中心化的 Skills 注册中心（Registry），技术栈：

| 层 | 技术 |
|---|------|
| 前端 | TanStack Start (React Router) + Tailwind CSS |
| 后端 | Convex (DB + 文件存储 + HTTP Actions) |
| 认证 | Convex Auth + GitHub OAuth |
| 搜索 | OpenAI `text-embedding-3-small` + Convex 向量搜索 |
| CLI | Node.js/Bun CLI (`clawhub` 包) |
| 共享类型 | `clawhub-schema` 包 |

### 1.2 Skill 格式

每个 Skill 是一个**自包含文件夹**，核心要求：
- 必须包含 `SKILL.md`（或 `skill.md`）
- 使用 YAML frontmatter 声明元数据
- 仅支持文本文件，总大小上限 50MB

Frontmatter 示例：

```yaml
name: my-skill
description: A useful skill
version: 1.2.0
metadata:
  openclaw:
    requires:
      env: [API_KEY]
      bins: [jq]
    primaryEnv: API_KEY
    install:
      - brew: some-tool
    nix:
      plugin: "github:org/repo?dir=tools/my-tool"
      systems: ["aarch64-darwin"]
```

### 1.3 版本管理

- **语义化版本（SemVer）**：每次发布创建不可变的 `skillVersions` 记录
- **Tag 系统**：字符串标签指向特定版本，`latest` 自动维护
- **回滚**：通过将标签指向旧版本实现
- **软删除**：版本可以隐藏但不物理删除
- **指纹去重**：SHA256 文件哈希组合作为版本指纹，防止重复发布

### 1.4 发布流程

通过 CLI 发布：

```bash
clawhub publish <folder> --slug <slug> --version <version> --changelog <text>
```

发布管线处理步骤：

1. **验证**：Slug 格式、SemVer、GitHub 帐号年龄 ≥ 14 天、文件大小 ≤ 50MB、纯文本、SKILL.md 存在
2. **解析**：Frontmatter 提取、`clawdis`/`openclaw` 元数据解析
3. **质量评估**（新 Skill）：
   - 信任层级（帐号年龄 + Skill 数量）
   - 质量信号（内容分析）
   - 相似度检查（结构指纹）
4. **内容处理**：
   - LLM 生成摘要（如需要）
   - 自动生成 changelog（如缺失）
   - SHA256 指纹计算
   - Embedding 向量生成（SKILL.md + 至多 40 个其他文件）
5. **存储**：创建 `skillVersions` → 更新 `skills` 表 → 存储 embedding
6. **安全扫描**（异步）：
   - VirusTotal 扫描
   - LLM 安全评估
7. **通知**：GitHub 备份、Discord Webhook

### 1.5 更新机制

- **CLI 更新**：`clawhub install <slug>@<version>` 或 `openclaw skills update [skill-id]`
- **批量更新**：`openclaw skills update --all` 或 `clawhub update --all`
- **自动更新**：社区提供 `auto-updater` Skill，通过 cron 每日 4:00 AM 自动更新
- **Sync 同步**：`clawhub sync` 将本地 Skill 目录与注册中心同步

### 1.6 安全保障

- **ClawHavoc 事件**（2026年2月）后加强安全措施：341 个恶意 Skill 被发现
- 所有发布必须通过 VirusTotal 扫描
- 发布者身份验证
- 每日重新扫描检测新威胁
- 发布速率限制基于信任等级
- Moderation 系统：`active`/`hidden`/`removed` 状态

---

## 2. OpenClaw 产品接入方式

### 2.1 关系定位

- **ClawhHub** = 注册中心（Registry）
- **OpenClaw** = 消费端（Consumer/Runtime）

### 2.2 接入方式

#### 配置文件发现

CLI 通过多种方式发现 OpenClaw 配置：

| 路径 | 说明 |
|------|------|
| `~/.openclaw/openclaw.json` | 主配置文件 |
| `OPENCLAW_CONFIG_PATH` 环境变量 | 自定义配置路径 |
| `OPENCLAW_STATE_DIR` 环境变量 | 状态目录 |

#### Skill 目录扫描

CLI 扫描多个可能的 Skill 安装位置：

- `~/.openclaw/skills/`
- `~/openclaw/skills/`
- `../openclaw/skills/`（相对路径）
- `~/Library/Application Support/openclaw/skills/`（macOS）

#### 元数据兼容

在 SKILL.md frontmatter 中，以下三个键互为别名：

```yaml
metadata:
  openclaw: { ... }    # 首选
  clawdbot: { ... }    # 兼容
  clawdis: { ... }     # 兼容
```

#### 安装流程

```bash
# OpenClaw 原生命令
openclaw skills install <skill-id>
openclaw skills install <skill-id>@1.2.0  # 指定版本

# 或通过 ClawhHub CLI
clawhub install <slug>
```

安装后 Skill 放置于 `~/.openclaw/skills/<skill-id>/`，下次会话重启后生效。

#### 遥测与统计

- `clawhub sync` 向注册中心报告安装统计
- 可通过 `CLAWHUB_DISABLE_TELEMETRY=1` 禁用
- 统计事件类型：downloads、stars、installs、comments

### 2.3 数据库层面的接入支持

Convex 数据库中专门维护的接入相关表：

- `userSkillInstalls`：用户 Skill 安装记录
- `userSkillRootInstalls`：用户安装根目录记录
- `skillStatEvents`：事件驱动的统计日志

---

## 3. 与 anthropics/financial-services-plugins 的技术异同

> **注意**：`hazeone/financial-services-plugins` 是 `anthropics/financial-services-plugins` 的 fork（0 stars），原始仓库有 3,373 stars、314 forks。

### 3.1 项目概况对比

| 维度 | ClawhHub | anthropics/financial-services-plugins |
|------|---------|--------------------------------------|
| **定位** | 通用 Skill 注册中心 + 市场 | 金融领域专用插件集 |
| **语言** | TypeScript (全栈) | Python + Markdown（无代码） |
| **许可** | 未标注 | Apache 2.0 |
| **Stars** | — (本仓库) | 3,373 |
| **Forks** | — | 314 |
| **架构模式** | Registry + CLI + Web UI | 插件 Marketplace（文件驱动） |
| **消费端** | OpenClaw runtime | Claude Cowork / Claude Code |
| **核心文件** | `SKILL.md` + frontmatter | `SKILL.md` + `plugin.json` + `.mcp.json` |

### 3.2 目录结构对比

**ClawhHub Skill：**

```
my-skill/
├── SKILL.md          # 必须，frontmatter + 指令
├── scripts/          # 可选脚本
├── references/       # 可选参考文档
└── assets/           # 可选资源
```

**Financial-Services Plugin：**

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json   # 插件清单（名称、版本、描述）
├── .mcp.json          # MCP 连接器配置
├── hooks/
│   └── hooks.json     # 钩子配置
├── commands/          # 斜杠命令（如 /comps.md, /dcf.md）
└── skills/            # 领域知识 SKILL.md
    ├── comps-analysis/
    │   └── SKILL.md
    ├── dcf-model/
    │   └── SKILL.md
    └── ...
```

### 3.3 核心技术差异

#### (a) 插件组织模式

| 特性 | ClawhHub | Financial-Services-Plugins |
|------|---------|---------------------------|
| 层级 | 扁平（每个 Skill 独立） | 分层（Core + Add-on 模式） |
| 依赖 | Skill 间无显式依赖 | Add-on 依赖 Core 的共享连接器 |
| 组合 | 用户自由安装组合 | Core 必装 → 按需加 Add-on |

Financial-Services-Plugins 采用了一个 **Core + Add-on 模式**：
- `financial-analysis`（Core）：提供共享建模工具和所有 11 个 MCP 数据连接器
- `investment-banking`、`equity-research`、`private-equity`、`wealth-management`（Add-on）：特定领域增强

#### (b) 数据连接（MCP）

| 特性 | ClawhHub | Financial-Services-Plugins |
|------|---------|---------------------------|
| MCP 支持 | 无内置 MCP | 核心特性，11 个 MCP 连接器 |
| 数据源 | Skill 自行处理 | Daloopa、Morningstar、S&P Global、FactSet 等 |
| 配置 | 在 frontmatter 中声明依赖 | `.mcp.json` 集中配置 |

`.mcp.json` 示例（financial-analysis）：

```json
{
  "mcpServers": {
    "daloopa": { "type": "http", "url": "https://mcp.daloopa.com/server/mcp" },
    "morningstar": { "type": "http", "url": "https://mcp.morningstar.com/mcp" },
    "sp-global": { "type": "http", "url": "https://kfinance.kensho.com/integrations/mcp" },
    "factset": { "type": "http", "url": "https://mcp.factset.com/mcp" }
  }
}
```

#### (c) 命令系统

| 特性 | ClawhHub | Financial-Services-Plugins |
|------|---------|---------------------------|
| 命令模式 | CLI 命令（`clawhub install`、`clawhub publish`） | 斜杠命令（`/comps`、`/dcf`、`/earnings`） |
| 用途 | Skill 生命周期管理 | 工作流触发（面向终端用户） |

Financial-Services-Plugins 提供 38 个 slash commands，直接在对话中使用：

```
/comps [company]                # 可比公司分析
/dcf [company]                  # DCF 估值模型
/earnings [company] [quarter]   # 盈利更新报告
/ic-memo [project name]         # 投委会备忘录
```

#### (d) Hooks 系统

| 特性 | ClawhHub | Financial-Services-Plugins |
|------|---------|---------------------------|
| Hooks | 无 | 支持 hooks.json 配置 |
| 用途 | — | SubagentStart、PreToolUse 等钩子 |

Financial-Services-Plugins 可以通过 hooks 在子代理启动前注入上下文，实现多代理协作。

#### (e) 分发与更新

| 特性 | ClawhHub | Financial-Services-Plugins |
|------|---------|---------------------------|
| 分发 | 中心化注册中心 + CLI 推送 | GitHub 仓库 + `claude plugin marketplace` |
| 版本管理 | SemVer + Tag + Fingerprint | `plugin.json` 中的 version 字段 |
| 安装命令 | `clawhub install <slug>` | `claude plugin install financial-analysis@financial-services-plugins` |
| 安全扫描 | VirusTotal + LLM 分析 | 无（依赖 GitHub 审核 + PR 流程） |

#### (f) Marketplace 聚合

Financial-Services-Plugins 顶层有 `.claude-plugin/marketplace.json` 作为多插件聚合清单：

```json
{
  "name": "financial-services-plugins",
  "plugins": [
    { "name": "financial-analysis", "source": "./financial-analysis" },
    { "name": "investment-banking", "source": "./investment-banking" },
    ...
  ]
}
```

这允许一个 Git 仓库承载多个插件，Claude 通过 marketplace add 命令一次注册整个仓库。ClawhHub 则是每个 Skill 独立发布、独立版本。

### 3.4 小结

| 方面 | ClawhHub 更强 | Financial-Services-Plugins 更强 |
|------|-------------|-------------------------------|
| 通用性 | 通用 Skill 市场，5700+ 技能 | 金融垂直领域深度 |
| 安全保障 | VirusTotal + LLM + 质量门控 | 依赖 GitHub 审核 |
| 搜索发现 | 向量搜索 + 趋势排序 | 人工分类 |
| 版本管理 | SemVer + Tag + 指纹 | 简单 version 字段 |
| 数据连接 | 无内置 | 11 个 MCP 连接器 |
| 工作流 | 基础安装/发布 | 端到端金融工作流 |
| 多代理 | 无 | Hooks 支持多代理协作 |
| 命令 | CLI 管理命令 | 38 个对话内 slash commands |

---

## 4. 高星 GitHub Skills 项目对比

### 4.1 anthropics/skills (11,177 stars)

**定位**：Agent Skills 开放规范（由 Anthropic 维护的行业标准）

**核心架构创新 — 渐进式加载（Progressive Disclosure）**：

```
Level 1 (元数据)  ~100 tokens/skill   → 名称 + 描述
Level 2 (指令)   ~2000 tokens/skill  → 完整 SKILL.md 内容
Level 3+ (资源)  按需加载            → 脚本、模板、参考文档
```

这种设计实现了 **85-95% 的 token 节省**，解决了 AI Agent 上下文窗口有限的核心问题。

**技术要点**：
- 定义了 `SKILL.md` 标准格式（YAML frontmatter + Markdown）
- 27+ AI 工具兼容（Claude Code, Cursor, Gemini CLI 等）
- SDK 实现：Python (Agno, LangChain, CrewAI)
- 30 位活跃贡献者

### 4.2 anthropics/financial-services-plugins (3,373 stars)

（已在第 3 节详述）

**核心架构创新**：
- **Core + Add-on 分层插件**：共享基础 + 按需扩展
- **MCP 连接器集中管理**：11 个金融数据源通过 `.mcp.json` 统一配置
- **Slash Commands**：38 个对话内触发的命令
- **Hooks**：多代理协作的钩子系统
- **Marketplace 聚合**：单仓库多插件，一次注册

### 4.3 github/awesome-copilot (22,500+ stars)

**定位**：GitHub Copilot 社区资源聚合（awesome-list 模式）

**架构特点**：
- 纯 Markdown 索引，无运行时
- 社区 PR 驱动的内容管理
- 按类别分类：Instructions、Agents、Skills、MCP Servers
- 与 Skills Hub 等目录工具配合使用

### 4.4 microsoft/skills (stars 未明，131 skills)

**定位**：Azure SDK + AI Foundry 专用 Skills

**核心架构创新**：
- **npx 安装向导**：`npx skills add microsoft/skills`，交互式选择安装
- **多角色 Agent 模板**：backend、frontend、infrastructure、planner
- **AGENTS.md 模板**：配置 Agent 行为的标准化方式
- **MCP 预配置**：Azure 40+ 服务的 MCP Server 配置
- **RBAC 安全**：通过 Azure 用户凭据 + 角色控制粒度权限

### 4.5 runkids/skillshare (573 stars)

**定位**：跨 AI 工具的 Skill 同步器

**核心架构创新**：
- **Go 语言 CLI**：高性能跨平台
- **声明式配置**：`skillshare.yaml` 定义 Skill 来源和目标
- **双向 Skill 流**：不仅安装，还能将本地 Skill 推送回源
- **安全审计**：内置 Skill 安全扫描
- **50+ AI Agent 支持**：最广泛的工具兼容性
- **可视化 UI**：提供图形界面管理

### 4.6 cloudvalley-tech/skillhub

**定位**：Git-native Skill 包管理器

**核心架构创新**：
- **Git 原生**：Skill 存储在 Git 仓库中，可版本控制和代码审查
- **两种安装模式**：全局（安装一次，到处链接）vs 项目级
- **零锁定**：使用标准文件格式，方便迁出
- **多工具同步**：Cursor, Claude Code, GitHub Copilot, Windsurf, Aider 等 10+ 工具
- **link 机制**：类似 npm link 的符号链接管理

### 4.7 numman-ali/openskills (362 stars)

**定位**：通用 Skills 加载器

**核心架构创新**：
- **npm 生态分发**：利用 npm 的版本管理和依赖解析
- **按需加载**：运行时才加载 Skill 内容
- **XML 标签生成**：将 Skill 转换为 XML 格式注入 Agent prompt
- **多来源安装**：GitHub repo、本地路径、私有 Git 仓库
- **框架无关**：兼容 Claude Code, Cursor, Windsurf, Aider 等

### 4.8 samueltauil/skills-hub

**定位**：GitHub Copilot Skills 目录网站

**核心架构创新**：
- **Astro 静态站**：构建为静态网站，部署在 GitHub Pages
- **Python 爬虫索引器**：自动从多个源仓库聚合 Skill
- **JSON Schema 注册**：标准化的 Skill 元数据 Schema
- **多源聚合**：从 `github/awesome-copilot`、`anthropics/skills`、`modelcontextprotocol/ext-apps` 聚合

---

## 5. 总结与建议

### 5.1 行业趋势

1. **标准化**：`SKILL.md` 已成为事实标准，27+ 工具支持
2. **渐进式加载**：token 效率是核心竞争力（anthropics/skills 的分级加载方案）
3. **安全第一**：ClawHavoc 事件推动全行业加强安全扫描
4. **跨工具兼容**：Skills 不再绑定单一 AI 工具，强调 "write once, run anywhere"
5. **MCP 集成**：数据连接层走向标准化（Model Context Protocol）
6. **垂直化**：通用市场 + 行业插件包（如金融）并行发展

### 5.2 ClawhHub 的优势

- **最完整的注册中心**：5,700+ Skills，40-60 新 Skills/天
- **安全体系成熟**：多层扫描（VirusTotal + LLM + 质量门控）
- **搜索能力强**：向量搜索 + 多维度排序
- **版本管理健全**：SemVer + Tag + 指纹去重

### 5.3 可以借鉴的方向

| 来源 | 可借鉴特性 |
|------|-----------|
| anthropics/skills | 渐进式加载（Level 1/2/3），大幅节省 token |
| financial-services-plugins | MCP 连接器集成、Slash Commands、Hooks 多代理协作、Core+Add-on 分层 |
| microsoft/skills | npx 交互式安装向导、多角色 Agent 模板 |
| skillshare | 双向 Skill 流、安全审计、50+ 工具支持 |
| skillhub | Git 原生版本管理、零锁定设计 |
| openskills | npm 生态分发、XML prompt 注入 |
| skills-hub | 多源聚合索引、静态目录站 |

### 5.4 架构差异总图

```
                    ┌─────────────────────────────────────────┐
                    │           Skills 生态系统分层            │
                    └─────────────────────────────────────────┘

    ┌──────────┐    ┌──────────────┐    ┌──────────────────────┐
    │  规范层   │    │  anthropics/  │    │  SKILL.md 标准格式    │
    │          │    │  skills      │    │  Agent Skills Spec   │
    └──────────┘    └──────────────┘    └──────────────────────┘
         │
    ┌──────────┐    ┌──────────────┐    ┌──────────────────────┐
    │  注册中心 │    │  ClawhHub    │    │  中心化 Registry      │
    │          │    │              │    │  向量搜索 + 安全扫描  │
    └──────────┘    └──────────────┘    └──────────────────────┘
         │
    ┌──────────┐    ┌──────────────┐    ┌──────────────────────┐
    │  分发层   │    │  clawhub CLI │    │  install/publish/sync │
    │          │    │  openskills  │    │  npm/git 分发         │
    │          │    │  skillhub    │    │  跨工具同步           │
    └──────────┘    └──────────────┘    └──────────────────────┘
         │
    ┌──────────┐    ┌──────────────┐    ┌──────────────────────┐
    │  运行时   │    │  OpenClaw    │    │  Skill 加载 + 执行    │
    │          │    │  Claude Code │    │  MCP 连接器           │
    │          │    │  Cursor ...  │    │  Hooks + Commands     │
    └──────────┘    └──────────────┘    └──────────────────────┘
         │
    ┌──────────┐    ┌──────────────┐    ┌──────────────────────┐
    │  垂直插件 │    │  financial-  │    │  Core + Add-on       │
    │          │    │  services    │    │  11 MCP 连接器        │
    │          │    │  microsoft/  │    │  38 Slash Commands    │
    └──────────┘    └──────────────┘    └──────────────────────┘
```
