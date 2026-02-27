# ClawX Desktop App — State Management Architecture Analysis

This document captures detailed findings from exploring the [ClawX](https://github.com/ValueCell-ai/ClawX) Electron desktop app's configuration and state management patterns.

---

## 1. Persistent Configuration via `electron-store`

ClawX uses **two separate `electron-store` instances** on the main process side for persisted configuration:

### 1a. Settings Store (`electron/utils/store.ts`)

- **File name on disk:** `settings.json` (stored in Electron's `userData` directory)
- **Schema type:** `AppSettings` interface
- **Lazy-loaded:** The `electron-store` module is ESM, so it's dynamically `import()`-ed and cached in a singleton (`settingsStoreInstance`).

**Persisted fields:**

| Category | Keys | Defaults |
|----------|------|----------|
| General | `theme`, `language`, `startMinimized`, `launchAtStartup` | `'system'`, `'en'`, `false`, `false` |
| Gateway | `gatewayAutoStart`, `gatewayPort`, `gatewayToken` | `true`, `18789`, random `clawx-<hex>` |
| Update | `updateChannel`, `autoCheckUpdate`, `autoDownloadUpdate`, `skippedVersions` | `'stable'`, `true`, `false`, `[]` |
| UI State | `sidebarCollapsed`, `devModeUnlocked` | `false`, `false` |
| Presets | `selectedBundles`, `enabledSkills`, `disabledSkills` | `['productivity', 'developer']`, `[]`, `[]` |

**Key design notes:**
- `gatewayToken` is auto-generated at first run using `crypto.randomBytes(16)` and persists across sessions. It is used for WebSocket authentication with the OpenClaw Gateway.
- Settings are accessed via async `getSetting(key)` / `setSetting(key, value)` functions, which hide the lazy initialization.
- Supports `exportSettings()` / `importSettings(json)` for backup.

### 1b. Provider Store (`electron/utils/secure-storage.ts`)

- **File name on disk:** `clawx-providers.json`
- **Purpose:** Stores AI provider configurations AND their API keys.
- **Schema shape:**
  ```
  {
    providers: Record<string, ProviderConfig>,
    apiKeys: Record<string, string>,
    defaultProvider: string | null
  }
  ```

**ProviderConfig fields:** `id`, `name`, `type` (ProviderType), `baseUrl?`, `model?`, `enabled`, `createdAt`, `updatedAt`.

**Key design notes:**
- Despite the filename "secure-storage", API keys are stored in **plain text** alongside provider configs in the same electron-store file. The comment says "Keys are stored in plain text alongside provider configs."
- Provider types include builtins (`anthropic`, `openai`, `google`, `openrouter`, `moonshot`, `siliconflow`, `minimax-portal`, `minimax-portal-cn`, `qwen-portal`, `ollama`) plus `custom`.
- `getAllProvidersWithKeyInfo()` performs a **sync check** against OpenClaw's `openclaw.json` config — if a provider exists in ClawX but not in the OpenClaw engine config, it's silently deleted from the ClawX store. This keeps the two in sync.
- Masked key display: keys > 12 chars show first 4 + stars + last 4 chars.

---

## 2. Settings Page (`src/pages/Settings/index.tsx`)

The Settings page is a single-file React component that exposes these setting groups:

| Section | Settings Persisted | Storage Layer |
|---------|-------------------|---------------|
| Appearance | `theme` (light/dark/system), `language` | Zustand + localStorage (`clawx-settings`) |
| AI Providers | Provider configs + API keys | electron-store (`clawx-providers.json`) via IPC |
| Gateway | `gatewayAutoStart`, status display, restart button | Zustand (frontend) + electron-store (backend) |
| Updates | `autoCheckUpdate`, `autoDownloadUpdate` | Zustand + localStorage |
| Advanced | `devModeUnlocked` | Zustand + localStorage |
| Developer (hidden) | Gateway token display, OpenClaw CLI path, Control UI URL | Read-only from main process |

**How settings flow:**
1. Frontend Zustand store (`src/stores/settings.ts`) uses `zustand/persist` middleware with `name: 'clawx-settings'`, which serializes to **localStorage**.
2. Some settings (gateway token, provider keys) live only on the main process side in electron-store and are read/written via IPC handlers.
3. The frontend `useSettingsStore` is the source of truth for UI preferences; the backend `electron/utils/store.ts` is the source of truth for gateway/security settings.

---

## 3. Gateway/Client OpenClaw State Management

### 3a. GatewayManager (`electron/gateway/manager.ts`)

The `GatewayManager` class is the core orchestrator. It:

- **Extends `EventEmitter`** and emits typed events: `status`, `message`, `notification`, `exit`, `error`, `channel:status`, `chat:message`.
- **Manages a child process:** Spawns the OpenClaw Gateway as a Node.js child process using the bundled `openclaw.mjs` entry point.
- **Maintains a WebSocket connection** to the Gateway on `ws://127.0.0.1:{port}`.
- **Tracks status** via a `GatewayStatus` object:
  ```typescript
  {
    state: 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting',
    port: number,
    pid?: number,
    uptime?: number,
    error?: string,
    connectedAt?: number,
    version?: string,
    reconnectAttempts?: number
  }
  ```
- **Authentication:** Uses a challenge-response handshake with Ed25519 device identity signing. The device identity (keypair) is persisted at `<userData>/clawx-device-identity.json` (mode 0o600).
- **RPC system:** Supports both OpenClaw's custom protocol (`{ type: "res", id, ok, payload }`) and legacy JSON-RPC 2.0 format. Pending requests tracked in a `Map<string, { resolve, reject, timeout }>`.
- **Reconnection:** Exponential backoff (1s base, 30s max, 10 max attempts). Can find and attach to an existing external Gateway process.
- **Health monitoring:** Periodic health checks via `system.health` RPC.
- **Environment injection:** Before spawning, collects all provider API keys and injects them as environment variables (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
- **Gateway token sync:** Writes the `gatewayToken` from electron-store into `~/.openclaw/openclaw.json` (`gateway.auth.token`) before starting, ensuring the spawned process uses the same token.

### 3b. GatewayClient (`electron/gateway/client.ts`)

A typed wrapper around `GatewayManager` that provides convenience methods:
- Channel management: `listChannels()`, `connectChannel()`, `disconnectChannel()`
- Skill management: `listSkills()`, `enableSkill()`, `disableSkill()`, `getSkillConfig()`, `updateSkillConfig()`
- Chat: `sendMessage()`, `getChatHistory()`, `clearChatHistory()`
- Cron: `listCronTasks()`, `createCronTask()`, `updateCronTask()`, `deleteCronTask()`
- System: `getHealth()`, `getConfig()`, `updateConfig()`, `getVersion()`

### 3c. Gateway Protocol (`electron/gateway/protocol.ts`)

Defines JSON-RPC 2.0 types and helpers:
- `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcNotification`
- `GatewayEventType` enum: `STATUS_CHANGED`, `CHANNEL_STATUS_CHANGED`, `MESSAGE_RECEIVED`, `MESSAGE_SENT`, `TOOL_CALL_STARTED`, `TOOL_CALL_COMPLETED`, `ERROR`
- Type guards: `isRequest()`, `isResponse()`, `isNotification()`

### 3d. Frontend Gateway Store (`src/stores/gateway.ts`)

Zustand store (no persistence) that:
- Mirrors the backend `GatewayStatus` to the React UI.
- Listens for IPC events: `gateway:status-changed`, `gateway:error`, `gateway:notification`, `gateway:chat-message`, `gateway:message`.
- Provides `start()`, `stop()`, `restart()`, `checkHealth()`, `rpc()` actions that proxy to the main process via IPC.
- Forwards agent/chat events to the chat store dynamically (`import('./chat')`).
- Singleton init guard via `gatewayInitPromise`.

---

## 4. Skills State Tracking

Skills state is managed across **three layers**:

### 4a. Gateway RPC (`skills.status`)
The OpenClaw Gateway is the source of truth for running skills. The RPC `skills.status` returns:
```typescript
{
  skills: [{
    skillKey: string,
    slug?: string,
    name?: string,
    description?: string,
    disabled?: boolean,
    emoji?: string,
    version?: string,
    author?: string,
    config?: Record<string, unknown>,
    bundled?: boolean,
    always?: boolean,
  }]
}
```

### 4b. ClawHub CLI (installed skills on disk)
`ClawHubService` (`electron/gateway/clawhub.ts`) manages skill installation:
- Skills are installed to `~/.openclaw/skills/{slug}/`
- Installation state tracked in `~/.openclaw/.clawhub/lock.json`
- Commands: `search`, `explore`, `install`, `uninstall`, `list`
- The CLI is run as a child process (either via the bundled binary or `process.execPath` with `ELECTRON_RUN_AS_NODE=1`).

### 4c. Skill Config in `~/.openclaw/openclaw.json`
`electron/utils/skill-config.ts` directly reads/writes `~/.openclaw/openclaw.json` → `skills.entries[skillKey]`:
```typescript
{
  enabled?: boolean,
  apiKey?: string,
  env?: Record<string, string>
}
```
This bypasses the Gateway RPC for faster/more reliable config updates.

### 4d. Frontend Skills Store (`src/stores/skills.ts`)

Zustand store (no persistence) that:
- `fetchSkills()` merges data from **three sources**:
  1. Gateway RPC `skills.status` (running skills with metadata)
  2. ClawHub `clawhub:list` (installed on disk)
  3. Direct config `skill:getAllConfigs` (apiKey/env from openclaw.json)
- Combined into a `Skill[]` array with fields: `id`, `slug`, `name`, `description`, `enabled`, `icon`, `version`, `author`, `config`, `isCore`, `isBundled`.
- Enable/disable goes through Gateway RPC `skills.update`.
- Install/uninstall goes through ClawHub IPC.
- Core skills (`bundled && always`) cannot be disabled.

### 4e. Skill Types (`src/types/skill.ts`)

```typescript
interface Skill {
  id: string; slug?: string; name: string; description: string;
  enabled: boolean; icon?: string; version?: string; author?: string;
  configurable?: boolean; config?: Record<string, unknown>;
  isCore?: boolean; isBundled?: boolean; dependencies?: string[];
}

interface SkillBundle {
  id: string; name: string; nameZh: string; description: string;
  descriptionZh: string; icon: string; skills: string[]; recommended?: boolean;
}

interface MarketplaceSkill {
  slug: string; name: string; description: string;
  version: string; author?: string; downloads?: number; stars?: number;
}
```

---

## 5. Cron System State Persistence

### 5a. Backend: Gateway-Managed

Cron jobs are **fully managed by the OpenClaw Gateway**. The Electron main process acts as a proxy:

- `cron:list` → Gateway RPC `cron.list` (with `includeDisabled: true`)
- `cron:create` → Gateway RPC `cron.add` (transforms frontend format → Gateway format)
- `cron:update` → Gateway RPC `cron.update`
- `cron:delete` → Gateway RPC `cron.remove`
- `cron:toggle` → Gateway RPC `cron.update` (with `{ enabled }` patch)

**Format transformation** in `ipc-handlers.ts`:
- Frontend sends plain cron expression strings.
- Gateway expects `CronSchedule` objects: `{ kind: 'cron', expr: '...' }`, `{ kind: 'every', everyMs: N }`, `{ kind: 'at', at: '...' }`.
- The IPC handler bridges between these two formats.

**Gateway CronJob state includes:**
```typescript
{
  id, name, description?, enabled, createdAtMs, updatedAtMs,
  schedule: { kind, expr?, everyMs?, at?, tz? },
  payload: { kind, message?, text? },
  delivery?: { mode, channel?, to? },
  state: { nextRunAtMs?, lastRunAtMs?, lastStatus?, lastError?, lastDurationMs? }
}
```

### 5b. Frontend Cron Store (`src/stores/cron.ts`)

Simple Zustand store (no persistence) with `CronJob[]` fetched from the backend. All mutations go through IPC → Gateway RPC. The UI shows:
- Job list with schedule, target channel, last run status, next run time
- Create/edit dialog with cron expression presets
- Toggle enable/disable, manual trigger, delete
- Statistics: total, active, paused, failed counts

### 5c. Cron Types (`src/types/cron.ts`)

```typescript
type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

interface CronJob {
  id: string; name: string; message: string;
  schedule: string | CronSchedule;
  target: CronJobTarget;
  enabled: boolean; createdAt: string; updatedAt: string;
  lastRun?: CronJobLastRun; nextRun?: string;
}
```

---

## 6. Environment Detection & Capability Probing

### 6a. OpenClaw Status (`electron/utils/paths.ts`)

`getOpenClawStatus()` checks:
- `packageExists`: Does `~/.openclaw` or bundled OpenClaw have a `package.json`?
- `isBuilt`: Does it have a `dist/` folder?
- `entryPath`: Path to `openclaw.mjs`
- `version`: Read from `package.json`

### 6b. Python/UV Detection (`electron/utils/uv-setup.ts`)

- `checkUvInstalled()`: Checks for bundled `uv` binary first (packaged mode), then falls back to system PATH.
- `isPythonReady()`: Runs `uv python find 3.12` to check if a managed Python is available.
- `setupManagedPython()`: Runs `uv python install 3.12` with optional CN mirror support and retry logic.

### 6c. Device Identity (`electron/utils/device-identity.ts`)

- Generates/loads an Ed25519 keypair for Gateway authentication.
- Persisted at `<userData>/clawx-device-identity.json` with file mode 0o600.
- Used in the Gateway WebSocket handshake to request operator scopes.

### 6d. Platform Detection (Settings Page)

```typescript
const isMac = window.electron.platform === 'darwin';
const isWindows = window.electron.platform === 'win32';
const isLinux = window.electron.platform === 'linux';
const isDev = window.electron.isDev;
```

Used to conditionally show: CLI tools section, OpenClaw CLI installer (macOS only), window controls (Windows/Linux custom title bar).

### 6e. Gateway Process Discovery

`GatewayManager.findExistingGateway()` probes `http://127.0.0.1:{port}/health` to detect if a Gateway process is already running (e.g., from a previous session or system service). If found, it attaches to it instead of spawning a new one.

---

## 7. Configuration Files on Disk

| File Path | Format | Purpose | Written By |
|-----------|--------|---------|------------|
| `<userData>/settings.json` | JSON (electron-store) | App settings (theme, gateway port, etc.) | electron-store |
| `<userData>/clawx-providers.json` | JSON (electron-store) | Provider configs + API keys | electron-store |
| `<userData>/clawx-device-identity.json` | JSON | Ed25519 keypair for Gateway auth | device-identity.ts |
| `~/.openclaw/openclaw.json` | JSON | OpenClaw master config (channels, skills, models, gateway, plugins, browser) | channel-config.ts, skill-config.ts, openclaw-auth.ts |
| `~/.openclaw/agents/{id}/agent/auth-profiles.json` | JSON | Per-agent API keys/OAuth tokens | openclaw-auth.ts |
| `~/.openclaw/agents/{id}/agent/models.json` | JSON | Per-agent model provider registry | openclaw-auth.ts |
| `~/.openclaw/skills/{slug}/` | Directory | Installed skill packages | ClawHub CLI |
| `~/.openclaw/.clawhub/lock.json` | JSON | ClawHub installation lock file | ClawHub CLI |
| `~/.openclaw/workspace/*.md` | Markdown | Workspace bootstrap files with ClawX context | openclaw-workspace.ts |

---

## 8. Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│  React Frontend (Renderer Process)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ settings │ │ gateway  │ │  skills  │ │   cron   │   │
│  │  store   │ │  store   │ │  store   │ │  store   │   │
│  │(persist) │ │(memory)  │ │(memory)  │ │(memory)  │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘   │
│       │             │            │             │         │
│  localStorage   IPC invoke    IPC invoke   IPC invoke    │
└───────┼─────────────┼────────────┼─────────────┼─────────┘
        │             │            │             │
┌───────┼─────────────┼────────────┼─────────────┼─────────┐
│  Electron Main Process                                    │
│       │             │            │             │         │
│  ┌────┴─────┐ ┌─────┴──────┐ ┌──┴───────┐ ┌──┴───┐     │
│  │electron- │ │ Gateway    │ │ ClawHub  │ │ cron │     │
│  │store x2  │ │ Manager    │ │ Service  │ │ IPC  │     │
│  │settings  │ │ (WS+proc)  │ │ (CLI)    │ │proxy │     │
│  │providers │ │            │ │          │ │      │     │
│  └────┬─────┘ └─────┬──────┘ └──┬───────┘ └──┬───┘     │
│       │              │           │             │         │
│  JSON files    WebSocket RPC  child_process  via GW RPC  │
│  in userData        │           │             │         │
└───────┼──────────────┼───────────┼─────────────┼─────────┘
        │              │           │             │
        ▼              ▼           ▼             ▼
  ┌──────────────────────────────────────────────────┐
  │  OpenClaw Gateway Process (port 18789)           │
  │  ~/.openclaw/openclaw.json (master config)       │
  │  ~/.openclaw/agents/*/agent/ (per-agent state)   │
  │  ~/.openclaw/skills/ (installed skills)          │
  └──────────────────────────────────────────────────┘
```

**Key patterns:**
1. **Dual persistence:** UI preferences in localStorage (via Zustand persist); security/backend config in electron-store files.
2. **Gateway as truth:** Skills, cron, channels, and chat are all managed by the OpenClaw Gateway process. ClawX is primarily a GUI that proxies requests.
3. **Direct file access for speed:** Skill configs and channel configs are sometimes written directly to `~/.openclaw/openclaw.json`, bypassing the Gateway RPC for reliability and speed.
4. **Three-source merging for skills:** Gateway status + ClawHub disk state + direct config are combined to build the complete skills picture.
5. **Bidirectional sync:** Provider configs are synchronized between ClawX's electron-store and OpenClaw's config files (auth-profiles.json, models.json, openclaw.json). Stale entries are cleaned up on each fetch.
