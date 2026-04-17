# Project Pilot

> Assign a Mate as the "pilot" of a project. The pilot remembers full development history, makes architectural decisions, and delegates coding tasks to a cheaper model (Sonnet/Haiku) via Claude Code.

**Created**: 2026-04-17
**Status**: Draft

---

## Problem

Currently, every session starts fresh. Claude Code has no persistent memory of project decisions, architecture, or history beyond what CLAUDE.md and session context provide. Users repeatedly re-explain the same context. Using Opus for every coding task is expensive when most tasks are routine.

## Vision

A Mate sits between the user and Claude Code as a "pilot":

```
Without pilot:
  User -> Claude Code (Opus)

With pilot:
  User -> Mate (Opus, persistent memory) -> Claude Code (Sonnet/Haiku)
```

The pilot Mate:
- Remembers the full development history (architecture decisions, past PRs, patterns, conventions)
- Understands the user's intent and translates it into precise coding instructions
- Delegates implementation to a cheaper, faster model via Claude Code
- Reviews the output and iterates if needed
- Maintains project consistency across sessions

## How It Works

### 1. Pilot Assignment

User assigns a Mate as pilot for a project. The Mate gets:
- Access to all session digests and memory from that project
- A system prompt section explaining its role as pilot
- Authority to invoke Claude Code sessions with a specified model

### 2. Conversation Flow

```
User: "Add email integration"

Pilot (Opus):
  - Recalls past architecture decisions, coding conventions
  - Reads relevant files to understand current state
  - Breaks the task into concrete steps
  - Writes detailed instructions for Claude Code

  -> Spawns Claude Code session (Sonnet):
     "Create lib/email-accounts.js following the attachXxx pattern.
      Use var, CommonJS. Encrypt passwords with AES-256-GCM.
      See lib/project-knowledge.js for pattern reference..."

  <- Reviews output
  - Checks for consistency with project patterns
  - Requests fixes if needed
  - Reports back to user
```

### 3. Model Hierarchy

| Role | Model | Purpose |
|------|-------|---------|
| Pilot (Mate) | Opus | Strategic thinking, memory, architecture, review |
| Coder (Claude Code) | Sonnet / Haiku | Implementation, file edits, tests |

The user can configure which model the coder uses. Default: Sonnet.

### 4. Pilot Memory

The pilot accumulates knowledge across sessions:
- Session digests (automatic)
- Architecture decisions (extracted from conversations)
- File ownership map (which modules do what)
- User preferences (coding style, review standards)
- Past mistakes and corrections

This memory persists in the Mate's knowledge files and session digests.

## Key Differences from Current Flow

| | Without Pilot | With Pilot |
|---|---|---|
| Context | Session-only | Persistent across sessions |
| Model cost | Opus for everything | Opus for thinking, Sonnet for coding |
| Instructions | User explains every time | Pilot remembers and translates |
| Review | User reviews code | Pilot reviews first, then user |
| Consistency | Depends on user | Pilot enforces patterns |

## Open Questions

1. **How does the pilot invoke Claude Code?** New SDK tool? Sub-agent spawn? Direct session creation with model override?
2. **Can the pilot run multiple coder sessions in parallel?** (e.g., "implement these 3 files simultaneously")
3. **How does the pilot handle coder failures?** Retry with more context? Escalate to Opus? Ask user?
4. **Should the pilot auto-review all code, or only when asked?**
5. **How to handle the pilot disagreeing with the user?** (e.g., user wants a quick hack, pilot knows it breaks architecture)
6. **Can a project have multiple pilots?** (e.g., frontend pilot + backend pilot)
7. **How does this interact with Ralph Loop?** Pilot could be the orchestrator for autonomous loops.

## Dependencies

- Mate memory system (exists: session digests)
- Mate knowledge files (exists)
- Model selection per session (exists: set_model)
- Sub-agent or delegated session spawning (needs design)
