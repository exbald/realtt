#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Real Team Translation - Development Environment Setup
# ============================================================

PORT="${PORT:-3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  Real Team Translation - Dev Setup"
echo "============================================"
echo ""

# ---- 1. Check prerequisites ----
echo "==> Checking prerequisites..."

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is not installed. Install Node.js 20+ first."
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required. Current: $(node -v)"
  exit 1
fi

if ! command -v pnpm &>/dev/null; then
  echo "ERROR: pnpm is not installed. Install it: npm install -g pnpm"
  exit 1
fi

echo "    Node.js: $(node -v)"
echo "    pnpm: $(pnpm -v)"
echo ""

# ---- 2. Check/Load environment variables ----
echo "==> Checking environment configuration..."

if [ ! -f .env ]; then
  echo "WARNING: No .env file found. Copying from env.example..."
  cp env.example .env
  echo "    Created .env from template. Please update with your API keys:"
  echo "    - DEEPGRAM_API_KEY (required for transcription)"
  echo "    - OPENROUTER_API_KEY (required for translation)"
  echo ""
fi

# Source .env for this script
set -a
source .env 2>/dev/null || true
set +a

# ---- 3. Start PostgreSQL via Docker ----
echo "==> Starting PostgreSQL..."

if ! command -v docker &>/dev/null; then
  echo "WARNING: Docker not found. Ensure PostgreSQL is running manually."
  echo "    Expected connection: POSTGRES_URL=${POSTGRES_URL:-not set}"
else
  # Check if postgres container is already running
  if docker ps --format '{{.Names}}' | grep -q "realtt-postgres" 2>/dev/null; then
    echo "    PostgreSQL container already running."
  else
    # Start docker compose (use project name to avoid conflicts)
    docker compose -p realtt up -d --wait 2>/dev/null || {
      echo "    Starting PostgreSQL container..."
      docker compose up -d --wait
    }
    echo "    PostgreSQL started on port 5432."
  fi
fi

# Wait for PostgreSQL to be ready
echo "    Waiting for PostgreSQL to accept connections..."
for i in $(seq 1 30); do
  if docker exec $(docker ps -q --filter "ancestor=pgvector/pgvector:pg18" 2>/dev/null | head -1) \
     pg_isready -U dev_user -d postgres_dev &>/dev/null 2>&1; then
    echo "    PostgreSQL is ready!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "    WARNING: Could not verify PostgreSQL readiness after 30s."
    echo "    Continuing anyway - if DB connection fails, check Docker."
  fi
  sleep 1
done
echo ""

# ---- 4. Install dependencies ----
echo "==> Installing npm dependencies..."

if [ ! -d node_modules ]; then
  pnpm install
  echo "    Dependencies installed."
else
  echo "    Dependencies already installed (node_modules exists)."
  echo "    To reinstall: rm -rf node_modules && pnpm install"
fi
echo ""

# ---- 5. Push database schema ----
echo "==> Pushing database schema..."

pnpm run db:push 2>/dev/null && {
  echo "    Schema applied successfully."
} || {
  echo "    WARNING: db:push failed. PostgreSQL may not be ready yet."
  echo "    Run 'pnpm run db:push' manually after confirming DB is running."
}
echo ""

# ---- 6. Kill any existing server on the port ----
echo "==> Checking for existing server on port $PORT..."

PID=$(lsof -ti :$PORT 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "    Killing existing process on port $PORT (PID: $PID)..."
  kill -9 $PID 2>/dev/null || true
  sleep 2
fi
echo ""

# ---- 7. Start development server ----
echo "==> Starting Next.js development server..."
echo ""

pnpm run dev &

# Wait for server to be ready
echo "    Waiting for server to start on http://localhost:$PORT ..."
for i in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:$PORT" 2>/dev/null; then
    echo ""
    echo "============================================"
    echo "  Server is ready!"
    echo "============================================"
    echo ""
    echo "  App:      http://localhost:$PORT"
    echo "  API:      http://localhost:$PORT/api/diagnostics"
    echo ""
    echo "  Environment:"
    echo "    PostgreSQL: ${POSTGRES_URL:-not configured}"
    echo "    Deepgram:   $([ -n "${DEEPGRAM_API_KEY:-}" ] && echo 'configured' || echo 'NOT SET - transcription will not work')"
    echo "    OpenRouter: $([ -n "${OPENROUTER_API_KEY:-}" ] && echo 'configured' || echo 'NOT SET - translation will not work')"
    echo ""
    echo "  Commands:"
    echo "    Stop server:  lsof -ti :$PORT | xargs kill"
    echo "    View logs:    tail -f /dev/stdout"
    echo "    DB Studio:    pnpm run db:studio"
    echo "    Lint:         pnpm run check"
    echo ""
    exit 0
  fi
  sleep 2
done

echo ""
echo "WARNING: Server did not respond within 120s."
echo "Check the output above for errors."
echo "The process may still be starting - try http://localhost:$PORT manually."
