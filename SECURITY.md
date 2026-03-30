# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainer directly or use GitHub's private vulnerability reporting feature
3. Include steps to reproduce and potential impact

## Scope

This project runs a game server on localhost. Security considerations:

### API Keys
- LLM API keys in `server/llm-providers.json` support `$ENV_VAR` references. **Never commit raw API keys.**
- The `/api/llm-providers` endpoint strips API keys before responding to clients.
- Game API keys (`SUPERNATURAL_API_KEY`) are hashed with SHA-256 and never stored in plain text after creation.

### Network
- The server binds to `localhost:3001` by default. It is not intended to be exposed to the public internet without additional hardening.
- CORS is restricted to `localhost:5173` and `localhost:3000`.
- Rate limiting is enforced per API key on all authenticated endpoints.

### Data
- All game state is in-memory. No persistent database. Server restart clears everything.
- No user authentication system exists yet. The API key system is for development use.

## Supported Versions

Only the latest version on `main` is supported.
