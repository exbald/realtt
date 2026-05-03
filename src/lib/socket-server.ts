import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

const SOCKET_PORT = parseInt(process.env.SOCKET_PORT || "3099", 10);

// Global singleton
let io: SocketIOServer | null = null;
let httpServer: ReturnType<typeof createServer> | null = null;

export function getIO(): SocketIOServer | null {
  return io;
}

export function startSocketServer(): Promise<SocketIOServer> {
  return new Promise((resolve, reject) => {
    if (io) {
      resolve(io);
      return;
    }

    httpServer = createServer();
    io = new SocketIOServer(httpServer, {
      cors: {
        origin: [
          process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
          "http://localhost:3000",
          "http://localhost:4343",
          /^http:\/\/localhost:\d+$/,
        ],
        methods: ["GET", "POST"],
        credentials: true,
      },
      transports: ["websocket", "polling"],
      allowUpgrades: true,
      pingTimeout: 20000,
      pingInterval: 25000,
      connectTimeout: 10000,
    });

    io.on("connection", (socket) => {
      // eslint-disable-next-line no-console
      console.log(
        `[Socket.io] Client connected: ${socket.id} (transport: ${socket.conn.transport.name})`
      );

      // Track transport upgrades (polling -> websocket)
      socket.conn.on("upgrade", (transport) => {
        // eslint-disable-next-line no-console
        console.log(
          `[Socket.io] Transport upgraded for ${socket.id}: ${transport.name}`
        );
      });

      // Handle session room joining - user joins a session room
      socket.on("join-session", (sessionId: string) => {
        socket.join(`session:${sessionId}`);
        // eslint-disable-next-line no-console
        console.log(
          `[Socket.io] Client ${socket.id} joined session: ${sessionId}`
        );
        // Acknowledge the join
        socket.emit("session-joined", { sessionId, socketId: socket.id });
      });

      // Handle session room leaving
      socket.on("leave-session", (sessionId: string) => {
        socket.leave(`session:${sessionId}`);
        // eslint-disable-next-line no-console
        console.log(
          `[Socket.io] Client ${socket.id} left session: ${sessionId}`
        );
      });

      // Handle recording control events
      socket.on(
        "start-recording",
        (data: { sessionId: string; targetLanguage: string }) => {
          // eslint-disable-next-line no-console
          console.log(
            `[Socket.io] Start recording: session=${data.sessionId}, target=${data.targetLanguage}`
          );
          // Store session info on socket for tracking
          socket.data.sessionId = data.sessionId;
          socket.data.targetLanguage = data.targetLanguage;
          socket.data.isRecording = true;
          socket.data.chunkCount = 0;
          socket.emit("recording-status", {
            status: "active",
            sessionId: data.sessionId,
          });
        }
      );

      // Handle audio chunks from client
      socket.on("audio-chunk", (data: ArrayBuffer | { data: ArrayBuffer }, callback?: (ack: { received: boolean; chunkIndex: number }) => void) => {
        const chunkCount = (socket.data.chunkCount || 0) + 1;
        socket.data.chunkCount = chunkCount;
        const sessionId = socket.data.sessionId || "unknown";

        // Log every 50th chunk to avoid flooding logs
        if (chunkCount % 50 === 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[Socket.io] Received chunk #${chunkCount} for session ${sessionId} (${typeof data === "object" && data instanceof ArrayBuffer ? (data as ArrayBuffer).byteLength : "unknown"} bytes)`
          );
        }

        // Acknowledge receipt if callback is provided
        if (typeof callback === "function") {
          callback({ received: true, chunkIndex: chunkCount });
        }
      });

      socket.on("stop-recording", (data: { sessionId: string }) => {
        // eslint-disable-next-line no-console
        console.log(
          `[Socket.io] Stop recording: session=${data.sessionId}, total chunks received: ${socket.data.chunkCount || 0}`
        );
        socket.data.isRecording = false;
        socket.data.chunkCount = 0;
        socket.emit("recording-status", {
          status: "stopped",
          sessionId: data.sessionId,
          totalChunks: socket.data.chunkCount || 0,
        });
      });

      socket.on("pause-recording", (data: { sessionId: string }) => {
        // eslint-disable-next-line no-console
        console.log(`[Socket.io] Pause recording: session=${data.sessionId}`);
        socket.data.isRecording = false;
        socket.emit("recording-status", {
          status: "paused",
          sessionId: data.sessionId,
        });
      });

      socket.on("resume-recording", (data: { sessionId: string }) => {
        // eslint-disable-next-line no-console
        console.log(`[Socket.io] Resume recording: session=${data.sessionId}`);
        socket.data.isRecording = true;
        socket.emit("recording-status", {
          status: "active",
          sessionId: data.sessionId,
        });
      });

      // Handle ping for connection health monitoring
      socket.on("ping", (callback: () => void) => {
        if (typeof callback === "function") {
          callback();
        }
      });

      // Handle disconnect
      socket.on("disconnect", (reason) => {
        // eslint-disable-next-line no-console
        console.log(
          `[Socket.io] Client disconnected: ${socket.id} (reason: ${reason})`
        );
      });

      // Handle errors
      socket.on("error", (error) => {
        console.error(`[Socket.io] Error on socket ${socket.id}:`, error);
      });
    });

    httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // eslint-disable-next-line no-console
        console.log(
          `[Socket.io] Port ${SOCKET_PORT} already in use, server likely already running`
        );
        resolve(io!);
      } else {
        reject(err);
      }
    });

    httpServer.listen(SOCKET_PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`[Socket.io] Server running on port ${SOCKET_PORT}`);
      resolve(io!);
    });
  });
}

export { SOCKET_PORT };
