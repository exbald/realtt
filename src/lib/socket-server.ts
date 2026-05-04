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

// Track translation errors per segment (segmentId -> error message)
const translationErrors = new Map<string, string>();

// Track Deepgram reconnection state per socket
const deepgramReconnectState = new Map<string, { attempts: number; maxAttempts: number; timer: ReturnType<typeof setTimeout> | null }>();

const DEEPGRAM_MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Map technical error messages to user-friendly messages.
 */
function getUserFriendlyDeepgramError(error: string): { title: string; message: string; canRetry: boolean } {
  const lower = error.toLowerCase();

  if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("network") || lower.includes("etimedout")) {
    return {
      title: "Connection Failed",
      message: "Unable to connect to the transcription service. Please check your internet connection.",
      canRetry: true,
    };
  }

  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("authentication")) {
    return {
      title: "Authentication Error",
      message: "The transcription service API key is invalid or missing. Please check your configuration.",
      canRetry: false,
    };
  }

  if (lower.includes("402") || lower.includes("payment") || lower.includes("quota") || lower.includes("limit exceeded") || lower.includes("insufficient")) {
    return {
      title: "Service Quota Exceeded",
      message: "The transcription service quota has been exceeded. Please check your Deepgram account.",
      canRetry: false,
    };
  }

  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many")) {
    return {
      title: "Rate Limited",
      message: "Too many requests to the transcription service. Please wait a moment and try again.",
      canRetry: true,
    };
  }

  if (lower.includes("503") || lower.includes("service unavailable") || lower.includes("overloaded")) {
    return {
      title: "Service Unavailable",
      message: "The transcription service is temporarily unavailable. Please try again in a moment.",
      canRetry: true,
    };
  }

  return {
    title: "Transcription Error",
    message: "An unexpected error occurred with the transcription service. Your existing transcript data is preserved.",
    canRetry: true,
  };
}

/**
 * Map translation error messages to user-friendly messages.
 */
function getUserFriendlyTranslationError(error: string): { message: string } {
  const lower = error.toLowerCase();

  if (lower.includes("api key not configured") || lower.includes("missing") || lower.includes("no api key")) {
    return { message: "Translation is not configured. Please set up an API key." };
  }

  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("authentication")) {
    return { message: "Translation service authentication failed. Please check your API key." };
  }

  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many")) {
    return { message: "Translation rate limit reached. The original text is preserved." };
  }

  if (lower.includes("503") || lower.includes("service unavailable") || lower.includes("overloaded")) {
    return { message: "Translation service is temporarily unavailable. The original text is preserved." };
  }

  if (lower.includes("402") || lower.includes("payment") || lower.includes("quota") || lower.includes("insufficient")) {
    return { message: "Translation service quota exceeded. Please check your plan." };
  }

  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("etimedout")) {
    return { message: "Could not reach the translation service. The original text is preserved." };
  }

  return { message: "Translation failed for this segment. The original text is preserved." };
}

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
          const friendlyError = getUserFriendlyTranslationError(error.message);
          // Always emit translation error for user feedback
          socket.emit("translation-error", {
            segmentId,
            error: friendlyError.message,
            originalError: error.message,
          });
          translationErrors.set(segmentId, friendlyError.message);
          activeTranslations.delete(segmentId);
          // eslint-disable-next-line no-console
          console.log(
            `[Translation] Error for segment ${segmentId}: ${friendlyError.message}`
          );
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

          // Clear any previous reconnection state
          const prevReconnect = deepgramReconnectState.get(socket.id);
          if (prevReconnect?.timer) clearTimeout(prevReconnect.timer);
          deepgramReconnectState.delete(socket.id);

          // Create Deepgram connection for this session
          const deepgram = new DeepgramClient(
            data.sessionId,
            data.targetLanguage,
            (result) => handleTranscriptResult(socket, result, data.targetLanguage),
            // onError: fired when Deepgram WebSocket encounters an error mid-stream
            (errorMsg) => {
              const friendlyError = getUserFriendlyDeepgramError(errorMsg);
              socket.emit("deepgram-error", {
                ...friendlyError,
                sessionId: data.sessionId,
                reconnecting: false,
              });
            },
            // onClose: fired when Deepgram WebSocket closes unexpectedly
            (code, reason) => {
              // eslint-disable-next-line no-console
              console.log(
                `[Socket.io] Deepgram connection lost for session ${data.sessionId}: code=${code}, reason=${reason}`
              );
              const friendlyError = getUserFriendlyDeepgramError(
                code === 1006 ? "Connection closed unexpectedly" : `Connection closed: ${reason}`
              );
              socket.emit("deepgram-error", {
                ...friendlyError,
                sessionId: data.sessionId,
                reconnecting: false,
              });
            },
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
            // Clear reconnection state on successful connect
            deepgramReconnectState.delete(socket.id);
          }).catch((err) => {
            console.error("[Socket.io] Deepgram connection failed:", err.message);
            const friendlyError = getUserFriendlyDeepgramError(err.message);
            socket.emit("recording-status", {
              status: "active",
              sessionId: data.sessionId,
              deepgramConnected: false,
              deepgramError: err.message,
            });
            // Emit user-friendly error
            socket.emit("deepgram-error", {
              ...friendlyError,
              sessionId: data.sessionId,
              reconnecting: false,
            });
          });
        }
      );

      // Handle retry-recording event (client requests reconnection to Deepgram)
      socket.on(
        "retry-deepgram",
        () => {
          const sessionId = socket.data.sessionId as string;
          const targetLanguage = socket.data.targetLanguage as string;

          if (!sessionId || !targetLanguage) {
            socket.emit("deepgram-error", {
              title: "Cannot Retry",
              message: "No active session found for reconnection.",
              canRetry: false,
              sessionId: null,
              reconnecting: false,
            });
            return;
          }

          // eslint-disable-next-line no-console
          console.log(`[Socket.io] Retrying Deepgram connection for session ${sessionId}`);

          // Clean up existing connection
          const existingDeepgram = deepgramConnections.get(socket.id);
          if (existingDeepgram) {
            existingDeepgram.close().catch(() => {});
            deepgramConnections.delete(socket.id);
          }

          socket.emit("deepgram-error", {
            title: "Reconnecting",
            message: "Attempting to reconnect to the transcription service...",
            canRetry: false,
            sessionId,
            reconnecting: true,
          });

          // Create new connection
          const deepgram = new DeepgramClient(
            sessionId,
            targetLanguage,
            (result) => handleTranscriptResult(socket, result, targetLanguage),
            // onError: fired when Deepgram WebSocket encounters an error mid-stream
            (errorMsg) => {
              const friendlyError = getUserFriendlyDeepgramError(errorMsg);
              socket.emit("deepgram-error", {
                ...friendlyError,
                sessionId,
                reconnecting: false,
              });
            },
            // onClose: fired when Deepgram WebSocket closes unexpectedly
            (_code, reason) => {
              const friendlyError = getUserFriendlyDeepgramError(
                `Connection closed: ${reason}`
              );
              socket.emit("deepgram-error", {
                ...friendlyError,
                sessionId,
                reconnecting: false,
              });
            },
          );
          deepgramConnections.set(socket.id, deepgram);

          deepgram.connect().then(() => {
            socket.emit("recording-status", {
              status: "active",
              sessionId,
              deepgramConnected: true,
            });
            // Notify client that reconnection succeeded
            socket.emit("deepgram-reconnected", {
              sessionId,
            });
            deepgramReconnectState.delete(socket.id);
          }).catch((err) => {
            console.error("[Socket.io] Deepgram retry failed:", err.message);
            const friendlyError = getUserFriendlyDeepgramError(err.message);

            // Track reconnection attempts
            const state = deepgramReconnectState.get(socket.id) || { attempts: 0, maxAttempts: DEEPGRAM_MAX_RECONNECT_ATTEMPTS, timer: null };
            state.attempts += 1;
            deepgramReconnectState.set(socket.id, state);

            socket.emit("deepgram-error", {
              ...friendlyError,
              sessionId,
              reconnecting: false,
              retryAttempt: state.attempts,
              maxRetries: state.maxAttempts,
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

      // Handle retry-translation for a specific segment
      socket.on(
        "retry-translation",
        (data: { segmentId: string; originalText: string; targetLanguage: string }) => {
          if (!data.segmentId || !data.originalText || !data.targetLanguage) return;
          if (activeTranslations.has(data.segmentId)) return; // Already translating

          // eslint-disable-next-line no-console
          console.log(`[Socket.io] Retrying translation for segment ${data.segmentId}`);

          // Clear previous error
          translationErrors.delete(data.segmentId);
          activeTranslations.add(data.segmentId);

          translateSegment(data.segmentId, data.originalText, data.targetLanguage, {
            onChunk: (segmentId, text, _isDone) => {
              socket.emit("translation-chunk", {
                segmentId,
                translatedText: text,
                isDone: false,
              });
            },
            onComplete: (segmentId, fullText) => {
              socket.emit("translation-chunk", {
                segmentId,
                translatedText: fullText,
                isDone: true,
              });
              activeTranslations.delete(segmentId);
              translationErrors.delete(segmentId);
            },
            onError: (segmentId, error) => {
              const friendlyError = getUserFriendlyTranslationError(error.message);
              socket.emit("translation-error", {
                segmentId,
                error: friendlyError.message,
                originalError: error.message,
              });
              translationErrors.set(segmentId, friendlyError.message);
              activeTranslations.delete(segmentId);
            },
          }).catch((err) => {
            console.error("[Translation] Retry error:", err);
            activeTranslations.delete(data.segmentId);
          });
        }
      );

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

        // Clean up reconnection state
        const reconnectState = deepgramReconnectState.get(socket.id);
        if (reconnectState?.timer) clearTimeout(reconnectState.timer);
        deepgramReconnectState.delete(socket.id);
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
