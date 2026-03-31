# Left Sidebar — God & Agent Overview Panel

> **Status**: Spec · not yet implemented
> **Depends on**: CHANGEREQ_LLM_ROLES.md (OrchestratorRole, LLM assignments)

---

## 1  Purpose

An always-visible left-side panel that gives players a persistent overview of every LLM "god" operating in the world and the agents they control. Each god card shows aggregate power; each agent row shows name, level, and status at a glance.

---

## 2  Layout

```
┌─────────────────┬──────────────────────────────────┬──────────────────┐
│  LEFT SIDEBAR    │         GAME VIEWPORT            │  RIGHT PANEL     │
│  (260 px)        │                                  │  (380 px)        │
│                  │                                  │                  │
│  ┌─────────────┐ │                                  │  (selection info  │
│  │ GOD CARD    │ │                                  │   & event log)   │
│  │ name  power │ │                                  │                  │
│  │ role  badge │ │                                  │                  │
│  ├─────────────┤ │                                  │                  │
│  │ agent row 1 │ │                                  │                  │
│  │ agent row 2 │ │                                  │                  │
│  ├─────────────┤ │                                  │                  │
│  │ GOD CARD 2  │ │                                  │                  │
│  │ ...         │ │                                  │                  │
│  └─────────────┘ │                                  │                  │
│                  │                                  │                  │
│  ── UNASSIGNED ─ │                                  │                  │
│  │ agent row N │ │                                  │                  │
└─────────────────┴──────────────────────────────────┴──────────────────┘
```

| Property | Value | Notes |
|---|---|---|
| Width | `SIDEBAR_W = 260` | Narrower than right panel — info is compact |
| Position | Left edge, full height | `x = 0`, `y = 0` |
| Background | `0x1a1a2e` at alpha 0.92 | Dark blue-black, semi-transparent |
| Scroll | Vertical mask-based scroll | Same technique as right panel event log |
| Z-order | UIScene overlay (fixed camera) | Does not scroll with game world |

The game camera viewport shifts right by `SIDEBAR_W` pixels (see §6).

---

## 3  God Card

Each LLM provider that has ≥1 agent assigned gets a god card.

### 3.1  Card Layout

```
┌────────────────────────────┐
│ ⚡ 847   ADVISOR           │  ← power score + role badge
│ Anthropic Claude            │  ← provider label
│ 3 agents                    │  ← agent count
├────────────────────────────┤
│ ● Kael    Lv 12  🪓 chop   │  ← agent row
│ ● Mira    Lv  7  🗡 fight  │
│ ○ Theron  Lv  4  💀 dead   │
└────────────────────────────┘
```

### 3.2  God Power Calculation

God power is the aggregate strength of all agents controlled by this LLM. It's a single number (integer) displayed prominently.

```typescript
function computeGodPower(agents: AgentState[]): number {
  let power = 0;
  for (const a of agents) {
    if (!a.alive) continue;

    // Skill contribution: sum of all 10 skill levels
    const totalSkillLevels = Object.values(a.skills)
      .reduce((sum, s) => sum + s.level, 0);

    // Stat contribution: sum of 6 base stats (range 3-18 each)
    const totalStats = a.baseStats.strength + a.baseStats.toughness
      + a.baseStats.agility + a.baseStats.endurance
      + a.baseStats.perception + a.baseStats.charisma;

    // Lives bonus: more lives = more potential
    const livesBonus = Math.floor((a.livesRemaining ?? 100) / 10);

    // Health factor: 0.0–1.0 multiplier so injured agents count less
    const healthFactor = a.needs.health / 100;

    // Equipment bonus: +5 per equipped slot
    const equipBonus = (a.inventory.equipment.mainHand ? 5 : 0)
      + (a.inventory.equipment.body ? 5 : 0)
      + (a.inventory.equipment.accessory ? 5 : 0);

    power += Math.floor(
      (totalSkillLevels * 2 + totalStats + livesBonus + equipBonus)
      * healthFactor
    );
  }
  return power;
}
```

Rough scale: a fresh agent ≈ 60-80 power. A skilled, equipped veteran ≈ 300-500.

### 3.3  Card Data

| Field | Source | Display |
|---|---|---|
| God name | `LLMProviderConfig.label` | Top line, bold |
| Role | `GameConfig.agentLLMAssignments` → role from OrchestratorLoop | Badge (color-coded) |
| Power | `computeGodPower(controlledAgents)` | Lightning icon + number |
| Agent count | count of assigned agents | "N agents" |

### 3.4  Role Badges

| Role | Color | Short Label |
|---|---|---|
| Advisor | `0x4ecdc4` (teal) | ADV |
| Puppeteer | `0xff6b6b` (red) | PUP |
| God | `0xffd93d` (gold) | GOD |
| Darwinist | `0x6c5ce7` (purple) | DAR |
| Parent | `0xa8e6cf` (mint) | PAR |
| Chaos Demon | `0xff4757` (crimson) | CHO |
| _(none/fallback)_ | `0x888888` (gray) | — |

---

## 4  Agent Row

Each agent under a god card is a compact single-line row.

### 4.1  Row Layout

```
● Kael    Lv 12  🪓 chopping
```

| Element | Width | Content |
|---|---|---|
| Alive dot | 8 px | `●` green if alive, `○` gray if dead |
| Name | 80 px max | Agent name, truncated with ellipsis |
| Level | 48 px | `Lv` + total skill level (sum of 10 skill levels) |
| Action | fill | Current action icon + short label |

### 4.2  Agent Level

"Level" in the sidebar is **total skill levels** (sum of all 10 skills), not any single skill. This gives a holistic sense of agent progression.

```typescript
function agentLevel(agent: AgentState): number {
  return Object.values(agent.skills).reduce((sum, s) => sum + s.level, 0);
}
```

Range: 0 (newborn) to 990 (max all skills at 99). Display as integer.

### 4.3  Action Icons

| Action | Icon | Label |
|---|---|---|
| `idle` | 💤 | idle |
| `walking` / `wander` | 🚶 | walk |
| `drinking` | 💧 | drink |
| `eating` | 🍖 | eat |
| `foraging` | 🌿 | forage |
| `chopping` | 🪓 | chop |
| `mining` | ⛏ | mine |
| `building` | 🔨 | build |
| `crafting` | 🛠 | craft |
| `fighting` | 🗡 | fight |
| `fleeing` | 🏃 | flee |
| `resting` | 😴 | rest |
| `taming` | 🤝 | tame |
| `socializing` | 💬 | talk |
| `planting` | 🌱 | plant |
| `dead` | 💀 | dead |

### 4.4  Clicking an Agent Row

Clicking an agent row in the sidebar:
1. Emits `sidebar:select_agent` event with the agent ID
2. GameScene pans camera to agent position
3. UIScene selects the agent (shows full detail in the right panel)

This makes the sidebar a quick-navigation tool.

---

## 5  Unassigned Agents Section

Agents with no LLM assigned (`llmProviderId === null`) appear in a special section at the bottom:

```
── NO GOD ──────────────────
● Riven   Lv  3  💤 idle
● Ash     Lv  1  🚶 walk
```

This section has no power score, just the agent rows. Its header is styled dimmer than god cards.

---

## 6  Viewport Adjustment

The game camera must shift right to accommodate the sidebar, matching how the right panel already shifts the camera left.

### 6.1  GameScene Changes

```typescript
// Current (right panel only):
const PANEL_W = 380;
this.cameras.main.setViewport(0, 0, width - PANEL_W, height);

// New (both panels):
const SIDEBAR_W = 260;
const PANEL_W = 380;
this.cameras.main.setViewport(SIDEBAR_W, 0, width - SIDEBAR_W - PANEL_W, height);
```

Camera bounds and drag-pan remain the same — only the viewport origin and size change.

### 6.2  Resize Handler

Both UIScene and GameScene resize handlers must account for `SIDEBAR_W`:

```typescript
// UIScene resize
handleResize(width: number, height: number) {
  // Left sidebar background
  this.sidebarBg.clear();
  this.sidebarBg.fillStyle(0x1a1a2e, 0.92);
  this.sidebarBg.fillRect(0, 0, SIDEBAR_W, height);

  // Right panel (existing)
  this.rightPanelBg.clear();
  this.rightPanelBg.fillStyle(0x1a1a2e, 0.92);
  this.rightPanelBg.fillRect(width - PANEL_W, 0, PANEL_W, height);
}
```

---

## 7  Data Flow

### 7.1  Source Data

All data comes from the existing `world:update` socket event which already broadcasts `AgentState[]`. No new socket events are needed.

| Field | Source in AgentState |
|---|---|
| Agent name | `agent.name` |
| Skill levels | `agent.skills` (SkillSet with 10 entries) |
| Current action | `agent.action` |
| Alive status | `agent.alive` |
| Lives remaining | `agent.livesRemaining` |
| LLM provider | `agent.llmProviderId` |
| Base stats | `agent.baseStats` |
| Health | `agent.needs.health` |
| Equipment | `agent.inventory.equipment` |

### 7.2  LLM Provider Lookup

The client already receives LLM provider configs via the `/api/llm-providers` endpoint (existing in server/src/index.ts). The sidebar caches this list on init and uses it to resolve `llmProviderId` → provider label.

### 7.3  Role Lookup

The OrchestratorRole for each agent is not currently on the wire. Two options:

**Option A (recommended)**: Add `llmRole?: string` to `AgentState` — one small string field per agent in `world:update`. Minimal bandwidth cost.

**Option B**: Client derives role from a separate REST endpoint or config event. More complex, stale data risk.

### 7.4  Update Frequency

The sidebar updates every `world:update` tick (10 Hz). Since it only reads existing fields and computes god power (simple arithmetic over ≤50 agents), there is no performance concern.

---

## 8  Sorting & Ordering

### 8.1  God Card Order

God cards are sorted by **power descending** — the most powerful god appears at the top. Ties broken by provider label alphabetically.

### 8.2  Agent Row Order

Within each god card, agents are sorted by:
1. Alive agents first (dead agents at bottom)
2. By total skill level descending

### 8.3  Smooth Reordering

To avoid jarring layout jumps every tick, reordering only happens when:
- An agent dies or respawns
- An agent's LLM assignment changes
- A god's rank changes by ≥2 positions

Power numbers and action labels update every tick; the order of cards and rows is stable between reorder triggers.

---

## 9  Scroll Behavior

If the total height of all god cards + agent rows exceeds the viewport height, the sidebar becomes scrollable:

- **Mouse wheel** scrolls the sidebar when the cursor is over it (x < SIDEBAR_W)
- **Scroll bounds**: clamped to [0, totalContentHeight - viewportHeight]
- Implementation: Phaser mask-based scroll (same as right panel event log scroll)
- Scroll position persists across updates (doesn't reset to top on world:update)

---

## 10  Implementation Plan

### Phase 1 — Static sidebar frame
- Add `SIDEBAR_W = 260` constant to both scenes
- Create sidebar background Graphics in UIScene
- Shift GameScene camera viewport right by SIDEBAR_W
- Update resize handlers

### Phase 2 — Agent grouping logic
- On each `world:update`, group agents by `llmProviderId`
- Compute god power per group
- Sort god cards and agent rows per §8

### Phase 3 — Render god cards
- Draw card backgrounds with role-colored accent stripe
- Render provider label, role badge, power score, agent count
- Use PIXEL_FONT consistent with right panel

### Phase 4 — Render agent rows
- Draw alive dot, name, level, action icon + label
- Handle name truncation for long names
- Render unassigned agents section

### Phase 5 — Interaction
- Add click handler on agent rows → camera pan + selection
- Add scroll input handling for overflow
- Add scroll mask

### Phase 6 — Wire field addition
- Add `llmRole?: string` to AgentState in shared/src/index.ts
- Server sets it from OrchestratorLoop assignment
- Client reads it for role badge display

---

## 11  New & Modified Files

### New
| File | Lines (est.) | Purpose |
|---|---|---|
| _none_ | — | All code goes into existing UIScene.ts and GameScene.ts |

### Modified
| File | Change |
|---|---|
| `shared/src/index.ts` | Add `llmRole?: string` to AgentState |
| `client/src/scenes/UIScene.ts` | Add sidebar rendering, scroll, click handlers (~200 lines) |
| `client/src/scenes/GameScene.ts` | Shift camera viewport, add SIDEBAR_W constant (~10 lines) |
| `server/src/GameLoop.ts` | Populate `llmRole` on agent state from orchestrator assignment (~5 lines) |

---

## 12  Edge Cases

| Case | Behavior |
|---|---|
| No LLMs assigned to any agent | Sidebar shows only "NO GOD" section with all agents |
| All agents dead | God power = 0; dead agents shown with `○` dot and `💀 dead` |
| Agent respawns | Moves from dead to alive in same god card; reorder triggered |
| LLM assignment changes mid-game | Agent moves between god cards on next update |
| 50 agents (max) all assigned | Sidebar scrolls; ~50 rows + god cards ≈ 900px content |
| Window too narrow | Sidebar always renders at 260px; game viewport shrinks |
| Provider removed while agents assigned | Agents fall to "NO GOD" section |
