# YOKE Roadmap

> Vendor-independent harness abstraction protocol for Clay.
> This file serves as plan, progress tracker, and hand-off document for coding agents.

---

## Context

Clay currently runs exclusively on Claude Code's agent SDK. YOKE extracts all SDK-coupled code behind an interface so Clay can support multiple agent runtimes without changing business logic.

- **Public name**: YOKE
- **Internal codename**: HAL (meme/dev use only)
- **Metaphor**: A yoke unifies multiple oxen. YOKE unifies multiple harnesses.
- **Design principle**: "What to do" stays in Clay. "How to deliver it to the SDK" moves to YOKE.
- **Architecture**: Interface + Implementation pattern. Clay calls the interface, never the SDK directly.
- **Extraction trigger**: When the Codex implementation is added, YOKE becomes a separate open-source repo.

### Strategy (two stages)

1. **Stage 1 (now)**: Define YOKE interface inside this project. Build Claude implementation. All SDK calls go through the interface. No separate repo yet.
2. **Stage 2 (Codex)**: Add Codex (OpenAI) implementation. At this point, extract YOKE as a standalone open-source package. Clay depends on it as a library.

### Pre-conditions (completed)

- sdk-bridge.js monolith (2,424 lines) decomposed via PR-29~32
- SDK calls wrapped in intermediate functions during refactoring
- getSDK() factory pattern preserved as runtime injection point
- MCP server SDK imports isolated as "SDK adapter zone"

---

## Phase 1: SDK Call Audit (scan)

**Goal**: Produce an up-to-date map of every SDK touch point in the post-refactoring codebase.

**Agent instruction**:

```
Scan the following files and all modules they import:
- server.js
- project.js
- All files under lib/

Search for:
1. SDK import/require: "@anthropic-ai", "claude-agent-sdk", "sdk-bridge", getSDK()
2. SDK direct calls: any method on objects imported from above
3. CLI spawn: spawn/exec calling "claude" binary
4. HTTP calls: api.anthropic.com or similar endpoints
5. Claude-specific data injection: CLAUDE.md read/write, .claude/ directory access,
   mate.yaml loading into sessions, skill registration as tools, permission setting

For each call site, record:
- file:line
- SDK method/function name
- One-line description of what it does
- Surrounding business context

Output as a markdown table. Do NOT modify any code. Append results to this file under
"## Phase 1 Results".
```

**Status**: Not started

---

## Phase 2: Interface Design + Classify

**Goal**: Define the YOKE interface based on audit results. Chad reviews and decides what crosses the interface boundary.

### Classification rules

| Decision | Criteria | Examples |
|----------|----------|---------|
| INTERFACE | "Would this change if we swapped to a different LLM runtime?" | SDK init, session lifecycle, message send/receive, API transport |
| CLAY | "Is this Clay's decision, not the SDK's?" | User auth, routing, Mate selection, CLAUDE.md content assembly, skill discovery, business error handling |

### Boundary cases

| Situation | Resolution |
|-----------|------------|
| Assemble CLAUDE.md then inject into session | Assembly (CLAY), injection call (INTERFACE) |
| Define permission policy then pass to SDK | Policy definition (CLAY), SDK permission call (INTERFACE) |
| Load/parse skills then register as tools | Loading/parsing (CLAY), tool registration call (INTERFACE) |

After classification, the INTERFACE items define YOKE's contract. Update the Phase 1 table with an INTERFACE/CLAY column.

**Status**: Not started

---

## Phase 3: Implement (Claude adapter)

**Goal**: Create the YOKE interface and Claude implementation. Rewire all call sites.

**Structure**:

```
lib/yoke/
  interface.js          # YOKE interface definition (the contract)
  adapters/
    claude.js           # Claude Code SDK implementation
```

**Agent instruction**:

```
Read the Phase 1 Results table in this file. For every row marked INTERFACE:

1. Define the corresponding function signature in lib/yoke/interface.js.
2. Implement it in lib/yoke/adapters/claude.js using the current SDK calls.
3. Replace the original call site to go through the YOKE interface.

Rules:
- Zero behavior change. Existing functionality must be identical.
- Interface signatures reflect what Clay needs, not SDK internals.
  e.g. startSession(opts) not sdk.createMentionSession(opts).
- Claude adapter maps interface calls to SDK-specific implementation.
- SDK-level try/catch moves into the adapter. Business error handling stays in place.
- After extraction, NO file outside lib/yoke/adapters/ should directly import
  "@anthropic-ai", "claude-agent-sdk", or call getSDK().

When done, append verification results to this file under "## Phase 3 Verification".
```

**Status**: Not started

---

## Phase 4: Protocol Documentation

**Goal**: Document the message protocol between sdk-bridge modules and sdk-worker.js.

This Unix domain socket + JSON-line protocol is the candidate foundation for YOKE's
cross-runtime message spec. Enumerate all message types, payloads, and response formats.

**Status**: Not started

---

## Phase 5: Codex Adapter + Open-source Extraction (future)

**Goal**: Add OpenAI Codex implementation of the YOKE interface. Extract YOKE as a standalone open-source package.

```
lib/yoke/
  interface.js
  adapters/
    claude.js           # existing
    codex.js            # new
```

At this point, move lib/yoke/ to its own repo. Clay imports it as a dependency.

**Status**: Deferred (triggers when Codex integration begins)

---

## Hand-off Log

Record agent hand-offs here. Each entry: date, agent/mate, what was done, what's next.

| Date | Agent | Done | Next |
|------|-------|------|------|
| | | | |

---

## Phase 1 Results

(Agent appends audit results here)

---

## Phase 3 Verification

(Agent appends verification results here)

- [ ] No direct SDK import in any file outside yoke-harness.js
- [ ] All yoke-harness.js exports are actually called (no dead functions)
- [ ] No Clay business logic inside yoke-harness.js
- [ ] Manual test: Mate session create, message exchange, skill execution all work
