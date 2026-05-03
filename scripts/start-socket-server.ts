#!/usr/bin/env npx tsx
/**
 * Standalone Socket.io server startup script.
 * Runs alongside Next.js on a separate port (default: 3001).
 */
import { startSocketServer, SOCKET_PORT } from "../src/lib/socket-server";

async function main() {
  try {
    await startSocketServer();
    console.log(`[Socket.io] Server started on port ${SOCKET_PORT}`);
    console.log(`[Socket.io] Ready for WebSocket connections at ws://localhost:${SOCKET_PORT}`);
  } catch (error) {
    console.error("[Socket.io] Failed to start server:", error);
    process.exit(1);
  }
}

main();
