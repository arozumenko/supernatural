# Contributing to Supernatural

Thank you for your interest in contributing to Supernatural.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install dependencies: `npm run install:all`
4. Run the dev environment: `npm run dev`
5. Make your changes
6. Build to verify: `npm run build`
7. Submit a pull request

## Project Structure

```
shared/    → Types and constants shared between server and client
server/    → Express + Socket.IO game server (tsx runtime)
client/    → Phaser 3 browser client (vite)
docs/      → Design specs and change requests
```

All three packages are TypeScript with ES modules and strict mode.

## Development

- Server runs with `tsx` (TypeScript execute) — no compilation step needed for dev
- Client uses Vite with hot module replacement
- `npm run dev` runs both concurrently
- Build order matters: shared -> server -> client

## Code Style

- TypeScript strict mode everywhere
- ES module imports with `.ts` extensions (handled by tsx/vite at runtime)
- Pixel font (`"Press Start 2P"`) for all UI text
- No external dependencies for LLM calls (uses native `fetch`)

## Architecture Notes

- **Server-authoritative**: All game logic runs on the server. The client is a renderer.
- **10 Hz tick rate**: Game simulation runs at 10 ticks per second.
- **Genome-driven AI**: Agent decisions read from a per-agent `BehaviorGenome` config, not hardcoded values. LLMs modify this genome.
- **Non-wire fields**: Heavy data (`currentGenome`, `currentJournal`, `journalArchive`) is stored as `(agent as any).field` to avoid sending it over Socket.IO every tick.

## Adding a New LLM Provider

1. Add the provider type to `LLMProviderConfig.provider` in `shared/src/genome.ts`
2. Add the API call method to `server/src/orchestrator/LLMCaller.ts` and `server/src/ai/LLMClient.ts`
3. Add an example entry to `server/llm-providers.json`
4. Update `README.md` if the provider requires special setup

## Adding a New Orchestrator Role

1. Add the role name to `OrchestratorRole` type in `shared/src/index.ts`
2. Add permissions to `ROLE_PERMISSIONS` in `shared/src/index.ts`
3. Add the system prompt to `ROLE_PROMPTS` in `server/src/orchestrator/roles.ts`
4. Add the role badge color/label to `UIScene.ts` constants
5. Add a prompt document in `docs/prompts/`

## Pull Request Guidelines

- Keep PRs focused on a single feature or fix
- Include a clear description of what changed and why
- Ensure `npm run build` succeeds with zero errors
- Test that the game starts and runs without crashes
