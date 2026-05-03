"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io as socketIOClient, Socket } from "socket.io-client";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3099";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface UseSocketOptions {
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean;
  /** Session ID to join on connect */
  sessionId?: string;
  /** Called when connection is established */
  onConnect?: (socket: Socket) => void;
  /** Called when disconnected */
  onDisconnect?: (reason: Socket.DisconnectReason) => void;
  /** Called when a reconnect attempt succeeds */
  onReconnect?: (socket: Socket) => void;
  /** Called on connection error */
  onError?: (error: Error) => void;
}

export interface UseSocketReturn {
  /** Current connection state */
  connectionState: ConnectionState;
  /** Whether the socket is connected */
  isConnected: boolean;
  /** The Socket.io client instance */
  socket: Socket | null;
  /** Manually connect */
  connect: () => void;
  /** Manually disconnect */
  disconnect: () => void;
  /** Number of reconnect attempts (resets on successful connect) */
  reconnectAttempts: number;
  /** Current transport type (polling, websocket) */
  transport: string | null;
}

export function useSocket(options: UseSocketOptions = {}): UseSocketReturn {
  const {
    autoConnect = true,
    sessionId,
    onConnect,
    onDisconnect,
    onReconnect,
    onError,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [isConnected, setIsConnected] = useState(false);
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [transport, setTransport] = useState<string | null>(null);

  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onReconnectRef = useRef(onReconnect);
  const onErrorRef = useRef(onError);

  // Keep refs in sync with latest callbacks
  useEffect(() => {
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onReconnectRef.current = onReconnect;
    onErrorRef.current = onError;
  }, [onConnect, onDisconnect, onReconnect, onError]);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    setConnectionState("connecting");

    const socket = socketIOClient(SOCKET_URL, {
      transports: ["websocket", "polling"],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 10000,
      autoConnect: true,
      forceNew: false,
    });

    socket.on("connect", () => {
      console.log(
        `[Socket.io] Connected: ${socket.id} (transport: ${socket.io.engine.transport.name})`
      );
      setIsConnected(true);
      setConnectionState("connected");
      setSocketInstance(socket);
      setReconnectAttempts(0);
      setTransport(socket.io.engine.transport.name);

      // Join session room if sessionId provided
      if (sessionId) {
        socket.emit("join-session", sessionId);
      }

      onConnectRef.current?.(socket);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[Socket.io] Disconnected: ${reason}`);
      setIsConnected(false);
      setConnectionState("disconnected");
      setSocketInstance(null);
      setTransport(null);
      onDisconnectRef.current?.(reason);
    });

    // Track reconnect attempts
    socket.io.on("reconnect_attempt", (attempt) => {
      console.log(`[Socket.io] Reconnect attempt #${attempt}`);
      setConnectionState("reconnecting");
      setReconnectAttempts(attempt);
    });

    socket.io.on("reconnect", (attempt) => {
      console.log(`[Socket.io] Reconnected after ${attempt} attempts`);
      setReconnectAttempts(0);
      onReconnectRef.current?.(socket);
    });

    socket.io.on("reconnect_failed", () => {
      console.log("[Socket.io] Reconnection failed");
      setConnectionState("disconnected");
    });

    // Track transport upgrades
    socket.io.engine.on("upgrade", (newTransport) => {
      console.log(
        `[Socket.io] Transport upgraded to: ${newTransport.name}`
      );
      setTransport(newTransport.name);
    });

    socket.on("connect_error", (error) => {
      console.error("[Socket.io] Connection error:", error.message);
      setConnectionState("disconnected");
      onErrorRef.current?.(error);
    });

    socketRef.current = socket;
  }, [sessionId]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      // Leave session room before disconnecting
      if (sessionId) {
        socketRef.current.emit("leave-session", sessionId);
      }
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setConnectionState("disconnected");
      setSocketInstance(null);
      setTransport(null);
    }
  }, [sessionId]);

  // Auto-connect and cleanup
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      if (socketRef.current) {
        // Leave session room before cleanup
        if (sessionId) {
          socketRef.current.emit("leave-session", sessionId);
        }
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [autoConnect, connect, sessionId]);

  return {
    connectionState,
    isConnected,
    socket: socketInstance,
    connect,
    disconnect,
    reconnectAttempts,
    transport,
  };
}
