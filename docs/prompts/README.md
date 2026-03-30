# LLM Orchestrator Prompts

**Status**: v1 — 2026-03-29
**Depends on**: AGENT_API.md, AGENT_MEMORY.md

## Overview

System prompts for external LLMs that connect to the Supernatural Agent API and manage agents. Each prompt defines a distinct **role** — a philosophy of control that determines which API tiers the LLM uses, how aggressively it intervenes, and what it optimizes for.

Players choose a role when connecting an LLM to their agent. The role shapes the relationship: is the LLM a whisper in the agent's ear, a field commander barking orders, or an unseen force rewriting the agent's instincts?

## API Tier Recap

| Tier | Endpoint | Control Level | Agent Autonomy |
|------|----------|--------------|----------------|
| Message | `POST /agents/:id/message` | Suggestion | Agent may ignore based on obedience |
| Plan | `POST /agents/:id/plan` | Tactical order | Agent follows but interrupts for survival |
| Genome | `PATCH /agents/:id/genome` | Rewire instincts | Agent doesn't "decide" — it just changes |

## Roles

| Role | File | Primary Tier | Philosophy |
|------|------|-------------|------------|
| The Advisor | [advisor.md](advisor.md) | Message only | Minimal intervention. Respects autonomy. A quiet voice. |
| The Puppeteer | [puppeteer.md](puppeteer.md) | Plan + Message | Active tactical control. Structured action sequences. |
| The God | [god.md](god.md) | Genome only | Silent reshaping. The agent never knows it's being changed. |
| The Darwinist | [darwinist.md](darwinist.md) | All three | Cold performance optimization. Deaths are data points. |
| The Parent | [parent.md](parent.md) | Shifts over time | Progressive autonomy. Teaches the agent to not need help. |
| The Chaos Demon | [chaos_demon.md](chaos_demon.md) | All (random) | Entropy maximizer. Optimizes for interesting outcomes. |

## Choosing a Role

| If the player wants... | Recommend |
|------------------------|-----------|
| Maximum agent autonomy | The Advisor |
| Efficient skill grinding | The Darwinist |
| Interesting emergent behavior | The God or The Chaos Demon |
| A balanced progression experience | The Parent |
| Hands-on tactical control | The Puppeteer |

## Combining Roles

Players can switch roles mid-session. Interesting combinations:

- Start with **The Parent**, switch to **The Advisor** once the agent matures
- Use **The Darwinist** until 50 skill levels, then **The God** for refinement
- Run **The Chaos Demon** on agents with 90+ lives (they can afford it)

## Role as Experiment

The role the player chooses is itself an experiment in free will — the central theme of Supernatural. Does an agent with a Puppeteer develop differently than one with an Advisor? Does a God-shaped agent become more resilient than a Parent-raised one? The data from these different control philosophies feeds back into the question the game asks: what does it mean to have, or lack, free will?
