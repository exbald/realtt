import crypto from "crypto";
import { randomUUID } from "crypto";
import http from "http";
import https from "https";
import { Duplex } from "stream";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { transcriptSegment, transcriptionSession } from "../schema";

/**
 * Lightweight WebSocket client using Node.js built-in modules.
 * Implements enough of RFC 6455 to connect to Deepgram's streaming API.
 */
class WebSocketClient {
  private req: http.ClientRequest | null = null;
  private rawSocket: Duplex | null = null;
  private connected = false;
  private handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.handlers[event];
    if (handlers) {
      for (const h of handlers) h(...args);
    }
  }

  connect(url: string, headers: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const isSecure = parsed.protocol === "wss:";
      const key = crypto.randomBytes(16).toString("base64");

      const reqHeaders: Record<string, string> = {
        ...headers,
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
      };

      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isSecure ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: reqHeaders,
      };

      const lib = isSecure ? https : http;
      this.req = lib.request(options);

      this.req.on("upgrade", (_res: http.IncomingMessage, socket: Duplex) => {
        this.rawSocket = socket;
        this.connected = true;

        // Handle incoming WebSocket frames
        let buffer = Buffer.alloc(0);

        socket.on("data", (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          // Process all complete frames in the buffer
          while (buffer.length > 0) {
            const result = this.decodeFrame(buffer);
            if (!result) break; // Incomplete frame
            buffer = buffer.subarray(result.bytesConsumed);

            if (result.opcode === 0x1) {
              // Text frame
              this.emit("data", result.payload);
            } else if (result.opcode === 0x2) {
              // Binary frame
              this.emit("data", result.payload);
            } else if (result.opcode === 0x8) {
              // Close frame
              this.connected = false;
              this.emit("close", 1000, "server close");
            } else if (result.opcode === 0x9) {
              // Ping - send pong
              this.sendFrame(0xa, result.payload);
            }
          }
        });

        socket.on("close", () => {
          this.connected = false;
          this.emit("close", 1006, "Connection closed");
        });

        socket.on("error", (err: Error) => {
          this.emit("error", err);
        });

        this.emit("open");
        resolve();
      });

      this.req.on("error", (err: Error) => {
        this.emit("error", err);
        reject(err);
      });

      this.req.end();
    });
  }

  private decodeFrame(buffer: Buffer): { opcode: number; payload: Buffer; bytesConsumed: number } | null {
    if (buffer.length < 2) return null;

    const opcode = buffer[0]! & 0x0f;
    const isMasked = (buffer[1]! & 0x80) !== 0;
    let payloadLength = buffer[1]! & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (buffer.length < 4) return null;
      payloadLength = buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (buffer.length < 10) return null;
      payloadLength = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }

    if (isMasked) {
      if (offset + 4 + payloadLength > buffer.length) return null;
      const maskKey = buffer.subarray(offset, offset + 4);
      const masked = buffer.subarray(offset + 4, offset + 4 + payloadLength);
      const unmasked = Buffer.alloc(masked.length);
      for (let i = 0; i < masked.length; i++) {
        unmasked[i] = masked[i]! ^ maskKey[i % 4]!;
      }
      return { opcode, payload: unmasked, bytesConsumed: offset + 4 + payloadLength };
    }

    if (offset + payloadLength > buffer.length) return null;
    return { opcode, payload: buffer.subarray(offset, offset + payloadLength), bytesConsumed: offset + payloadLength };
  }

  private sendFrame(opcode: number, data: Buffer = Buffer.alloc(0)): void {
    if (!this.rawSocket || !this.connected) return;

    const maskKey = crypto.randomBytes(4);
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) {
      masked[i] = data[i]! ^ maskKey[i % 4]!;
    }

    let header: Buffer;
    if (data.length < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x80 | opcode; // FIN + opcode
      header[1] = 0x80 | data.length; // Masked + length
      maskKey.copy(header, 2);
    } else if (data.length < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(data.length, 2);
      maskKey.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
      maskKey.copy(header, 10);
    }

    this.rawSocket.write(Buffer.concat([header, masked]));
  }

  send(data: Buffer | ArrayBuffer | string): void {
    if (data instanceof ArrayBuffer) {
      this.sendFrame(0x2, Buffer.from(data)); // Binary frame
    } else if (Buffer.isBuffer(data)) {
      this.sendFrame(0x2, data); // Binary frame
    } else {
      this.sendFrame(0x1, Buffer.from(data, "utf-8")); // Text frame
    }
  }

  close(): void {
    if (this.connected) {
      this.sendFrame(0x8, Buffer.alloc(0)); // Close frame
      this.connected = false;
    }
    if (this.rawSocket) {
      try {
        this.rawSocket.end();
      } catch {
        /* ignore */
      }
      this.rawSocket = null;
    }
    if (this.req) {
      try {
        this.req.destroy();
      } catch {
        /* ignore */
      }
      this.req = null;
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Deepgram streaming transcription client.
 *
 * Connects to Deepgram's WebSocket API, sends audio chunks for real-time
 * transcription with speaker diarization, and emits results back via callback.
 */

export interface DeepgramResult {
  id: string;
  speakerLabel: string;
  originalText: string;
  translatedText: string | null;
  startTime: number;
  endTime: number;
  isFinal: boolean;
}

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker: number;
  punctuated_word?: string;
}

interface DeepgramChannelAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

interface DeepgramMessage {
  type: string;
  channel: {
    alternatives: DeepgramChannelAlternative[];
  };
  is_final: boolean;
  duration: number;
  start: number;
}

interface DeepgramUtteranceEndMessage {
  type: "UtteranceEnd";
  last_word_end?: number;
  channel?: number[];
}

type ResultCallback = (result: DeepgramResult) => void;
type ErrorCallback = (error: string) => void;
type CloseCallback = (code: number, reason: string) => void;

export class DeepgramClient {
  private ws: WebSocketClient | null = null;
  private sessionId: string;
  private onResult: ResultCallback;
  private onErrorCallback: ErrorCallback | null;
  private onCloseCallback: CloseCallback | null;
  private isConnected = false;
  private pendingSegments = new Map<string, DeepgramResult>();
  private speakerSet = new Set<string>();
  private hasApiKey: boolean;
  private apiKey: string;
  private intentionallyClosing = false;

  constructor(
    sessionId: string,
    _targetLanguage: string,
    onResult: ResultCallback,
    onError?: ErrorCallback,
    onClose?: CloseCallback,
  ) {
    this.sessionId = sessionId;
    this.onResult = onResult;
    this.onErrorCallback = onError ?? null;
    this.onCloseCallback = onClose ?? null;
    this.apiKey = process.env.DEEPGRAM_API_KEY || "";
    this.hasApiKey = !!(this.apiKey && this.apiKey.trim());
  }

  async connect(): Promise<void> {
    if (!this.hasApiKey) {
      console.warn(
        "[Deepgram] No API key configured. Transcription disabled for this session."
      );
      throw new Error("Deepgram API key not configured. Please set DEEPGRAM_API_KEY.");
    }

    // Build Deepgram WebSocket URL with parameters
    const params = new URLSearchParams({
      encoding: "webm_opus",
      sample_rate: "16000",
      channels: "1",
      diarize: "true",
      punctuate: "true",
      interim_results: "true",
      utterance_end_ms: "1500",
      vad_events: "true",
      language: "en",
      model: "nova-3",
    });

    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    this.ws = new WebSocketClient();

    this.ws.on("open", () => {
      // eslint-disable-next-line no-console
      console.log(`[Deepgram] Connected for session ${this.sessionId}`);
      this.isConnected = true;
    });

    this.ws.on("data", (data: unknown) => {
      try {
        this.handleMessage((data as Buffer).toString());
      } catch (err) {
        console.error("[Deepgram] Error processing message:", err);
      }
    });

    this.ws.on("close", (code: unknown, reason: unknown) => {
      const codeNum = typeof code === "number" ? code : 1006;
      const reasonStr = typeof reason === "string" ? reason : "unknown";
      // eslint-disable-next-line no-console
      console.log(
        `[Deepgram] Connection closed: code=${codeNum}, reason=${reasonStr}`
      );
      this.isConnected = false;
      // Notify callback only for unexpected closes (not intentional close() calls)
      if (!this.intentionallyClosing) {
        this.onCloseCallback?.(codeNum, reasonStr);
      }
    });

    this.ws.on("error", (error: unknown) => {
      const errMsg = (error as Error).message || "Unknown WebSocket error";
      console.error(
        "[Deepgram] WebSocket error:",
        errMsg
      );
      this.isConnected = false;
      // Notify callback about the error
      this.onErrorCallback?.(errMsg);
    });

    await this.ws.connect(url, {
      Authorization: `Token ${this.apiKey}`,
    });
  }

  sendAudio(data: ArrayBuffer | Buffer): void {
    if (this.ws && this.isConnected) {
      if (Buffer.isBuffer(data)) {
        this.ws.send(data);
      } else {
        this.ws.send(Buffer.from(data));
      }
    }
  }

  async close(): Promise<void> {
    this.intentionallyClosing = true;

    // Finalize all pending segments
    for (const [, segment] of this.pendingSegments) {
      if (segment.originalText.trim()) {
        await this.saveSegmentToDatabase({ ...segment, isFinal: true });
      }
    }
    this.pendingSegments.clear();

    // Update session speaker count
    if (this.speakerSet.size > 0) {
      try {
        await db
          .update(transcriptionSession)
          .set({ speakerCount: this.speakerSet.size })
          .where(eq(transcriptionSession.id, this.sessionId));
      } catch (err) {
        console.error("[Deepgram] Error updating speaker count:", err);
      }
    }

    if (this.ws) {
      // Send CloseStream JSON message to Deepgram
      try {
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch {
        // Ignore send errors on close
      }
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  private handleMessage(data: string): void {
    let message: DeepgramMessage | DeepgramUtteranceEndMessage;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }

    if (message.type === "Results") {
      this.handleTranscriptionResult(message as DeepgramMessage);
    } else if (message.type === "UtteranceEnd") {
      this.handleUtteranceEnd(message as DeepgramUtteranceEndMessage);
    }
    // Ignore other message types (SpeechStarted, Metadata, etc.)
  }

  private handleTranscriptionResult(message: DeepgramMessage): void {
    const alternative = message.channel?.alternatives?.[0];
    if (!alternative) return;

    const transcript = alternative.transcript?.trim();
    if (!transcript) return;

    // Determine speaker label from words
    let speakerLabel = "Speaker 1";
    const words = alternative.words || [];
    if (words.length > 0 && words[0]?.speaker !== undefined) {
      speakerLabel = `Speaker ${words[0].speaker}`;
    }

    // Calculate timing from words
    let startTime = message.start || 0;
    let endTime = startTime + (message.duration || 0);

    if (words.length > 0) {
      startTime = words[0]!.start;
      endTime = words[words.length - 1]!.end;
    }

    const result: DeepgramResult = {
      id: randomUUID(),
      speakerLabel,
      originalText: transcript,
      translatedText: null,
      startTime: Math.round(startTime * 100) / 100,
      endTime: Math.round(endTime * 100) / 100,
      isFinal: message.is_final,
    };

    // Track speakers
    this.speakerSet.add(speakerLabel);

    if (message.is_final) {
      // Final result - save to database and emit
      this.saveSegmentToDatabase(result).catch((err) => {
        console.error("[Deepgram] Error saving segment:", err);
      });

      // Remove any pending interim segment for this speaker range
      const pendingKey = `${speakerLabel}-${Math.floor(startTime)}`;
      this.pendingSegments.delete(pendingKey);
    } else {
      // Interim result - cache and emit for real-time display
      const pendingKey = `${speakerLabel}-${Math.floor(startTime)}`;
      this.pendingSegments.set(pendingKey, result);
    }

    // Emit result to client
    this.onResult(result);
  }

  private handleUtteranceEnd(message: DeepgramUtteranceEndMessage): void {
    const lastEnd = message.last_word_end || 0;

    for (const [key, segment] of this.pendingSegments) {
      if (segment.endTime <= lastEnd) {
        if (segment.originalText.trim()) {
          const finalSegment = { ...segment, isFinal: true };
          this.saveSegmentToDatabase(finalSegment).catch((err) => {
            console.error("[Deepgram] Error saving utterance segment:", err);
          });
          this.onResult(finalSegment);
        }
        this.pendingSegments.delete(key);
      }
    }
  }

  private async saveSegmentToDatabase(result: DeepgramResult): Promise<void> {
    try {
      await db.insert(transcriptSegment).values({
        id: result.id,
        sessionId: this.sessionId,
        speakerLabel: result.speakerLabel,
        originalText: result.originalText,
        translatedText: result.translatedText,
        startTime: result.startTime,
        endTime: result.endTime,
        isFinal: result.isFinal,
      });
    } catch (err) {
      console.error("[Deepgram] Error inserting segment into database:", err);
    }
  }
}
