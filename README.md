# AP Physics AI Tutor

A full-stack web platform where students upload physics homework problems, submit solution attempts, and receive **tiered hints** instead of immediate answers. After five attempts, the system reveals the full solution and compares the student's reasoning to the correct approach.

## Features

- **5-tier hint ladder** — progressively stronger guidance without giving away the answer early
- **8 AP Physics unit packs** — pre-written Tier 1–4 hints stored in JSON (no LLM cost)
- **Two-model AI architecture** — cheap model for classification/routing, expensive model only for Tier 5
- **Solution caching** — identical problems reuse cached Tier 5 solutions
- **File upload** — PDF, images, or plain text
- **Secure API** — keys stay server-side with rate limiting

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- An [Anthropic API key](https://console.anthropic.com/)

### Installation

```bash
cd ap-physics-ai-tutor
npm install
```

### Configuration

Copy the example environment file and add your API key:

```bash
cp .env.example .env
```

Edit `.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
CHEAP_MODEL=claude-3-5-haiku-20241022
EXPENSIVE_MODEL=claude-sonnet-4-20250514
PORT=3000
```

### Run

```bash
npm start
```

Open **http://localhost:3000** in your browser.

For development with auto-restart:

```bash
npm run dev
```

## How the Hint Ladder Works

| Attempt | Tier | Source | Description |
|---------|------|--------|-------------|
| 1 | Tier 1 | Static JSON | Conceptual foundation |
| 2 | Tier 2 | Static JSON | Relevant principles & equations |
| 3 | Tier 3 | Static JSON | Targeted problem-solving guidance |
| 4 | Tier 4 | Static JSON | Near-solution scaffold |
| 5 | Tier 5 | Expensive LLM (cached) | Full solution + reasoning comparison |

Each attempt is analyzed by the **cheap model** (Haiku) for feedback — but hints for Tiers 1–4 come exclusively from local JSON hint packs. The **expensive model** (Sonnet) is called only at Tier 5.

The **Reveal Answer** button is disabled until Tier 5 is reached.

## Cost-Optimized AI Architecture

```
Student uploads problem
        │
        ▼
┌───────────────────┐
│  Cheap Model      │  ← Classification, variable extraction, unit ID
│  (Haiku)          │  ← Attempt analysis & feedback
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  Static Hint Pack │  ← Tiers 1–4 (zero LLM cost)
│  (unit1–8.json)   │
└───────────────────┘
        │
        ▼ (Attempt 5 only)
┌───────────────────┐
│  Cache Check      │  ← SHA-256 hash of problem text
└───────────────────┘
        │
   cache miss?
        │
        ▼
┌───────────────────┐
│  Expensive Model  │  ← Tier 5 full solution + comparison
│  (Sonnet)         │  ← Result saved to cache
└───────────────────┘
```

## Caching

Tier 5 solutions are cached in `backend/cache/` keyed by a SHA-256 hash of the normalized problem text. When the same (or very similar) problem appears again:

1. The cache is checked first
2. If found, the cached solution is returned instantly
3. The expensive model is **not** called

Cache files are JSON and persist across server restarts.

## Project Structure

```
ap-physics-ai-tutor/
├── frontend/
│   ├── index.html       # Main UI
│   ├── styles.css       # Physics-themed styling
│   ├── app.js           # Client logic
│   └── assets/
├── backend/
│   ├── server.js        # Express entry point
│   ├── routes.js        # API routes & session management
│   ├── aiController.js  # Two-model AI logic
│   ├── cache.js         # Tier 5 solution caching
│   ├── hintpacks/       # Static Tier 1–4 hints
│   │   ├── unit1.json   # Kinematics
│   │   ├── unit2.json   # Dynamics
│   │   ├── ...
│   │   └── unit8.json   # Electric Charge & Force
│   ├── cache/           # Cached Tier 5 solutions
│   └── uploads/         # Temporary file uploads
├── .env                 # API keys (not committed)
├── .env.example
├── package.json
└── README.md
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/problem` | Upload/submit a problem (multipart or text) |
| POST | `/api/attempt` | Submit an attempt, receive hint for current tier |
| POST | `/api/reveal` | Reveal Tier 5 solution (after 5 attempts) |
| GET | `/api/session/:id` | Get session state |
| GET | `/api/health` | Health check |

All `/api/*` routes are rate-limited (default: 100 requests per 15 minutes per IP).

## Adding New Hint Packs

1. Create or edit a file in `backend/hintpacks/` (e.g., `unit1.json`)
2. Follow this structure:

```json
{
  "unitId": 1,
  "unitName": "Kinematics",
  "topics": ["1D motion", "projectile motion"],
  "hints": {
    "default": {
      "tier1": { "title": "...", "content": "..." },
      "tier2": { "title": "...", "content": "..." },
      "tier3": { "title": "...", "content": "..." },
      "tier4": { "title": "...", "content": "..." },
      "tier5": { "title": "...", "content": "..." }
    },
    "projectile_motion": {
      "tier1": { "title": "...", "content": "..." }
    }
  }
}
```

3. Restart the server — hint packs are loaded at startup
4. The cheap model's classification returns a `problemType` key that maps to hint categories (falls back to `default`)

## Security Notes

- API keys are stored in `.env` and never sent to the frontend
- All LLM calls go through backend proxy endpoints
- Rate limiting prevents API abuse
- Uploaded files are stored temporarily in `backend/uploads/`

## License

MIT
