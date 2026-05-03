# Real Team Translation

Real-time transcription and translation tool for journalists. Capture audio from meetings or calls via browser microphone, transcribe speech in real-time using Deepgram with speaker diarization, and translate the transcript on-the-fly to a target language via OpenRouter.

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend**: Next.js API Routes, Drizzle ORM, PostgreSQL 18 (Docker)
- **Real-time**: Socket.io for WebSocket communication
- **Speech-to-Text**: Deepgram API (streaming transcription with speaker diarization)
- **Translation**: OpenRouter via Vercel AI SDK
- **Auth**: Better Auth (email/password)

## Quick Start

```bash
# 1. Set up environment
cp env.example .env
# Edit .env with your API keys (DEEPGRAM_API_KEY, OPENROUTER_API_KEY)

# 2. Run the setup script (installs deps, starts Docker PostgreSQL, pushes schema, starts dev server)
./init.sh

# Or manually:
pnpm install
docker compose up -d
pnpm run db:push
pnpm run dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_URL` | Yes | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Yes | Session encryption key |
| `DEEPGRAM_API_KEY` | Yes | Deepgram API key for speech-to-text |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key for translation |
| `OPENROUTER_MODEL` | No | LLM model for translation (default: openai/gpt-5-mini) |

## Development

```bash
pnpm run dev          # Start development server (http://localhost:3000)
pnpm run check        # Run lint + typecheck
pnpm run db:studio    # Open Drizzle Studio (database GUI)
pnpm run db:push      # Push schema changes to database
```

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── session/            # Session pages (new, live, completed)
│   ├── settings/           # User settings page
│   ├── dashboard/          # Session list dashboard
│   └── api/                # API routes
│       ├── sessions/       # Session CRUD + export
│       └── settings/       # User settings API
├── components/
│   ├── session/            # Session-related components
│   ├── transcript/         # Transcript display components
│   ├── recording/          # Recording controls
│   └── settings/           # Settings form components
├── lib/
│   ├── socketio/           # Socket.io server/client setup
│   ├── transcription/      # Deepgram integration
│   ├── translation/        # OpenRouter translation
│   └── schema.ts           # Drizzle database schema
└── types/                  # TypeScript type definitions
```

## Architecture

1. **Audio Capture**: Browser microphone -> Socket.io WebSocket -> Server
2. **Transcription**: Server -> Deepgram WebSocket -> Speaker-labeled transcript segments
3. **Translation**: Final segments -> OpenRouter LLM -> Translated text -> Socket.io -> Client
4. **Storage**: All data persisted in PostgreSQL via Drizzle ORM
5. **Export**: Server-side Markdown generation from session data
