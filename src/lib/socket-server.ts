import { createServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { DeepgramClient, DeepgramResult } from "./transcription/deepgram-client";
import { translateSegment } from "./translation/openrouter-client";

const SOCKET_PORT = parseInt(process.env.SOCKET_PORT || "3099", 10);

// Global singleton
let io: SocketIOServer | null = null;
let httpServer: ReturnType<typeof createServer> | null = null;

// Track Deepgram connections per socket
const deepgramConnections = new Map<string, DeepgramClient>();

// Track active translation streams to avoid duplicate translations
const activeTranslations = new Set<string>();

export function getIO(): SocketIOServer | null {
  return io;
}

function handleTranscriptResult(
  socket: Socket,
  result: DeepgramResult,
  targetLanguage: string
): void {
  // Emit transcript segment to the client
  socket.emit("transcript-segment", {
    id: result.id,
    speakerLabel: result.speakerLabel,
    originalText: result.originalText,
    translatedText: result.translatedText,
    startTime: result.startTime,
    endTime: result.endTime,
    isFinal: result.isFinal,
  });

  // Log significant events
  if (result.isFinal && result.originalText.trim()) {
    // eslint-disable-next-line no-console
    console.log(
      `[Deepgram] Final segment: "${result.originalText.substring(0, 50)}${result.originalText.length > 50 ? "..." : ""}" (${result.speakerLabel}, ${result.startTime.toFixed(1)}s-${result.endTime.toFixed(1)}s)`
    );

    // Trigger translation for final segments
    if (!activeTranslations.has(result.id) && targetLanguage) {
      activeTranslations.add(result.id);
      translateSegment(result.id, result.originalText, targetLanguage, {
        onChunk: (segmentId, text, _isDone) => {
          // Stream partial translation to the client
          socket.emit("translation-chunk", {
            segmentId,
            translatedText: text,
            isDone: false,
          });
        },
        onComplete: (segmentId, fullText) => {
          // Send final translation to the client
          socket.emit("translation-chunk", {
            segmentId,
            translatedText: fullText,
            isDone: true,
          });
          activeTranslations.delete(segmentId);
          // eslint-disable-next-line no-console
          console.log(
            `[Translation] Completed segment ${segmentId}: "${fullText.substring(0, 50)}${fullText.length > 50 ? "..." : ""}"`
          );
        },
        onError: (segmentId, error) => {
          // Don't emit error for expected cases (no API key, empty text)
          if (
            !error.message.includes("API key not configured") &&
            !error.message.includes("Empty text")
          ) {
            socket.emit("translation-error", {
              segmentId,
              error: error.message,
            });
          }
          activeTranslations.delete(segmentId);
        },
      }).catch((err) => {
        console.error("[Translation] Unhandled error:", err);
        activeTranslations.delete(result.id);
      });
    }
  }
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
        async (data: { sessionId: string; targetLanguage: string }) => {
          // eslint-disable-next-line no-console
          console.log(
            `[Socket.io] Start recording: session=${data.sessionId}, target=${data.targetLanguage}`
          );
          // Store session info on socket for tracking
          socket.data.sessionId = data.sessionId;
          socket.data.targetLanguage = data.targetLanguage;
          socket.data.isRecording = true;
          socket.data.chunkCount = 0;

          // Create Deepgram connection for this session
          const deepgram = new DeepgramClient(
            data.sessionId,
            data.targetLanguage,
            (result) => handleTranscriptResult(socket, result, data.targetLanguage)
          );

          // Store in our map
          deepgramConnections.set(socket.id, deepgram);

          // Connect to Deepgram (non-blocking)
          deepgram.connect().then(() => {
            socket.emit("recording-status", {
              status: "active",
              sessionId: data.sessionId,
              deepgramConnected: true,
            });
          }).catch((err) => {
            console.error("[Socket.io] Deepgram connection failed:", err.message);
            socket.emit("recording-status", {
              status: "active",
              sessionId: data.sessionId,
              deepgramConnected: false,
              deepgramError: err.message,
            });
          });
        }
      );

      // Handle audio chunks from client
      socket.on("audio-chunk", (data: ArrayBuffer | { data: ArrayBuffer }, callback?: (ack: { received: boolean; chunkIndex: number }) => void) => {
        const chunkCount = (socket.data.chunkCount || 0) + 1;
        socket.data.chunkCount = chunkCount;
        const sessionId = socket.data.sessionId || "unknown";

        // Forward audio chunk to Deepgram
        const deepgram = deepgramConnections.get(socket.id);
        if (deepgram) {
          let audioData: ArrayBuffer;
          if (data instanceof ArrayBuffer) {
            audioData = data;
          } else if (data && typeof data === "object" && "data" in data) {
            audioData = (data as { data: ArrayBuffer }).data;
          } else {
            audioData = data as unknown as ArrayBuffer;
          }
          deepgram.sendAudio(Buffer.from(audioData));
        }

        // Log every 50th chunk to avoid flooding logs
        if (chunkCount % 50 === 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[Socket.io] Received chunk #${chunkCount} for session ${sessionId}`
          );
        }

        // Acknowledge receipt if callback is provided
        if (typeof callback === "function") {
          callback({ received: true, chunkIndex: chunkCount });
        }
      });

      socket.on("stop-recording", async (data: { sessionId: string }) => {
        // eslint-disable-next-line no-console
        console.log(
          `[Socket.io] Stop recording: session=${data.sessionId}, total chunks received: ${socket.data.chunkCount || 0}`
        );
        socket.data.isRecording = false;

        // Close Deepgram connection and save final segments
        const deepgram = deepgramConnections.get(socket.id);
        if (deepgram) {
          await deepgram.close();
          deepgramConnections.delete(socket.id);
        }

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
      socket.on("disconnect", async (reason) => {
        // eslint-disable-next-line no-console
        console.log(
          `[Socket.io] Client disconnected: ${socket.id} (reason: ${reason})`
        );

        // Clean up Deepgram connection
        const deepgram = deepgramConnections.get(socket.id);
        if (deepgram) {
          await deepgram.close();
          deepgramConnections.delete(socket.id);
        }
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
