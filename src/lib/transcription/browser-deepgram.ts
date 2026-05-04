/**
 * Browser-side Deepgram streaming client.
 *
 * Connects directly to wss://api.deepgram.com/v1/listen using a short-lived
 * temporary key issued by /api/deepgram/token. Audio chunks are sent in;
 * transcript results come back via callbacks.
 */

export interface DeepgramSegment {
  id: string;
  speakerLabel: string;
  originalText: string;
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

interface DeepgramResultsMessage {
  type: "Results";
  channel: { alternatives: Array<{ transcript: string; words: DeepgramWord[] }> };
  is_final: boolean;
  duration: number;
  start: number;
}

interface DeepgramUtteranceEndMessage {
  type: "UtteranceEnd";
  last_word_end?: number;
}

type DeepgramMessage = DeepgramResultsMessage | DeepgramUtteranceEndMessage | { type: string };

export type BrowserDeepgramState = "idle" | "connecting" | "open" | "closed" | "error";

export interface BrowserDeepgramCallbacks {
  onSegment: (segment: DeepgramSegment) => void;
  onUtteranceEnd?: (lastWordEnd: number) => void;
  onStateChange?: (state: BrowserDeepgramState) => void;
  onError?: (error: Error) => void;
  onClose?: (code: number, reason: string) => void;
}

export interface BrowserDeepgramOptions {
  language?: string;
  model?: string;
}

function randomId(): string {
  // crypto.randomUUID is available in modern browsers
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `seg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export class BrowserDeepgramClient {
  private ws: WebSocket | null = null;
  private state: BrowserDeepgramState = "idle";
  private speakers = new Set<string>();
  private cb: BrowserDeepgramCallbacks;
  private opts: Required<BrowserDeepgramOptions>;

  constructor(callbacks: BrowserDeepgramCallbacks, options: BrowserDeepgramOptions = {}) {
    this.cb = callbacks;
    this.opts = {
      language: options.language ?? "en",
      model: options.model ?? "nova-3",
    };
  }

  get currentState(): BrowserDeepgramState {
    return this.state;
  }

  get speakerCount(): number {
    return this.speakers.size;
  }

  private setState(state: BrowserDeepgramState): void {
    this.state = state;
    this.cb.onStateChange?.(state);
  }

  /**
   * Fetch a temporary key from the server, then open the Deepgram WebSocket.
   * The temp key is passed via Sec-WebSocket-Protocol since browsers can't set
   * arbitrary headers on WebSocket connections.
   */
  async connect(): Promise<void> {
    this.setState("connecting");

    const tokenRes = await fetch("/api/deepgram/token", { method: "POST" });
    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      const message = err?.error || `Failed to get Deepgram key (${tokenRes.status})`;
      this.setState("error");
      throw new Error(message);
    }
    const { key } = (await tokenRes.json()) as { key: string };

    // For WebM/Opus container audio from MediaRecorder, Deepgram auto-detects
    // encoding, sample_rate, and channels from the container header. Sending
    // those params explicitly causes Deepgram to reject the connection.
    const params = new URLSearchParams({
      diarize: "true",
      punctuate: "true",
      interim_results: "true",
      utterance_end_ms: "1500",
      vad_events: "true",
      language: this.opts.language,
      model: this.opts.model,
    });

    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    return new Promise<void>((resolve, reject) => {
      let opened = false;
      try {
        // Browsers expose Deepgram auth via the Sec-WebSocket-Protocol header.
        const ws = new WebSocket(url, ["token", key]);
        ws.binaryType = "arraybuffer";
        this.ws = ws;

        ws.onopen = () => {
          opened = true;
          this.setState("open");
          resolve();
        };

        ws.onmessage = (ev) => {
          if (typeof ev.data !== "string") return;
          try {
            const msg = JSON.parse(ev.data) as DeepgramMessage;
            this.handleMessage(msg);
          } catch (err) {
            console.error("[Deepgram] Bad message:", err);
          }
        };

        ws.onerror = () => {
          const err = new Error("Deepgram WebSocket error");
          if (!opened) {
            this.setState("error");
            reject(err);
          } else {
            this.cb.onError?.(err);
          }
        };

        ws.onclose = (ev) => {
          this.setState("closed");
          this.cb.onClose?.(ev.code, ev.reason || "");
          if (!opened) reject(new Error(`Deepgram closed before open: ${ev.code}`));
        };
      } catch (err) {
        this.setState("error");
        reject(err);
      }
    });
  }

  /** Send a binary audio chunk to Deepgram. */
  send(chunk: ArrayBuffer | Blob): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (chunk instanceof Blob) {
      chunk.arrayBuffer().then((buf) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(buf);
      });
    } else {
      this.ws.send(chunk);
    }
  }

  /** Cleanly close the Deepgram socket, finalising any in-flight transcript. */
  async close(): Promise<void> {
    if (!this.ws) return;
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
      }
    } catch {
      /* ignore */
    }
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.setState("closed");
  }

  private handleMessage(msg: DeepgramMessage): void {
    if (msg.type === "Results") {
      this.handleResults(msg as DeepgramResultsMessage);
    } else if (msg.type === "UtteranceEnd") {
      const m = msg as DeepgramUtteranceEndMessage;
      this.cb.onUtteranceEnd?.(m.last_word_end ?? 0);
    }
  }

  private handleResults(msg: DeepgramResultsMessage): void {
    const alt = msg.channel?.alternatives?.[0];
    if (!alt) return;
    const transcript = alt.transcript?.trim();
    if (!transcript) return;

    let speakerLabel = "Speaker 1";
    const words = alt.words || [];
    if (words.length > 0 && words[0]?.speaker !== undefined) {
      speakerLabel = `Speaker ${words[0].speaker}`;
    }

    let startTime = msg.start || 0;
    let endTime = startTime + (msg.duration || 0);
    if (words.length > 0) {
      startTime = words[0]!.start;
      endTime = words[words.length - 1]!.end;
    }

    this.speakers.add(speakerLabel);

    this.cb.onSegment({
      id: randomId(),
      speakerLabel,
      originalText: transcript,
      startTime: Math.round(startTime * 100) / 100,
      endTime: Math.round(endTime * 100) / 100,
      isFinal: msg.is_final,
    });
  }
}
