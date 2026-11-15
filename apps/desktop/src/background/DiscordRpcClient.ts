// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off -- Discord IPC is a callback-driven local socket adapter with cancellable reconnect and throttle timers.
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";

import {
  createDiscordActivity,
  normalizeDiscordActivityContext,
  normalizeDiscordPresenceConfig,
  type DiscordActivityContext,
  type DiscordPresenceConfig,
  type DiscordPresenceState,
} from "@t3tools/shared/discordPresence";

const PIPE_COUNT = 10;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const ACTIVITY_TIMEOUT_MS = 10_000;
const MIN_PUBLISH_INTERVAL_MS = 15_000;
const MAX_FRAME_BYTES = 1024 * 1024;
const HEADER_BYTES = 8;

const OPCODE_HANDSHAKE = 0;
const OPCODE_FRAME = 1;
const OPCODE_CLOSE = 2;
const OPCODE_PING = 3;
const OPCODE_PONG = 4;

export type DiscordSocket = Pick<
  NodeNet.Socket,
  "setTimeout" | "on" | "write" | "destroy" | "destroyed"
>;

export interface DiscordRpcClientOptions {
  readonly connect?: (options: { path: string }) => DiscordSocket;
  readonly onStatus?: (status: string) => void;
  readonly retryMs?: number;
  readonly platform: NodeJS.Platform;
  readonly runtimeDirectory?: string;
}

export function encodeDiscordFrame(opcode: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(opcode, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function pipePath(platform: NodeJS.Platform, runtimeDirectory: string, index: number): string {
  return platform === "win32"
    ? `\\\\?\\pipe\\discord-ipc-${index}`
    : `${runtimeDirectory}/discord-ipc-${index}`;
}

// Local Discord IPC only: no token, no network service, no renderer access.
export class DiscordRpcClient {
  readonly startedAt = Math.floor(Date.now() / 1000);
  config: DiscordPresenceConfig = normalizeDiscordPresenceConfig();
  presence: DiscordPresenceState = {};
  context: DiscordActivityContext = normalizeDiscordActivityContext();

  private readonly connect: (options: { path: string }) => DiscordSocket;
  private readonly onStatus: (status: string) => void;
  private readonly retryMs: number;
  private readonly platform: NodeJS.Platform;
  private readonly runtimeDirectory: string;
  private generation = 0;
  private running = false;
  private ready = false;
  private socket: DiscordSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivity = "";
  private lastPublishedAt = 0;

  constructor(options: DiscordRpcClientOptions) {
    this.connect =
      options.connect ?? ((connectOptions) => NodeNet.createConnection(connectOptions));
    this.onStatus = options.onStatus ?? (() => {});
    this.retryMs = options.retryMs ?? 15_000;
    this.platform = options.platform;
    this.runtimeDirectory =
      options.runtimeDirectory ?? process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? "/tmp";
  }

  start(config?: unknown): void {
    this.stop();
    this.config = normalizeDiscordPresenceConfig(config);
    this.lastActivity = "";
    if (!this.config.enabled) return this.onStatus("Disabled");
    if (!this.config.clientId) return this.onStatus("Application ID required");
    this.running = true;
    this.onStatus("Connecting to Discord");
    this.tryPipe(0, this.generation);
  }

  update(presence: DiscordPresenceState = {}, context: unknown = this.context): void {
    this.presence = presence;
    this.context = normalizeDiscordActivityContext(context);
    this.publish();
  }

  stop(): void {
    this.running = false;
    this.ready = false;
    this.generation++;
    clearTimeout(this.retryTimer);
    clearTimeout(this.publishTimer ?? undefined);
    this.publishTimer = null;
    this.lastPublishedAt = 0;
    this.socket?.destroy();
    this.socket = null;
  }

  private tryPipe(index: number, generation: number): void {
    if (!this.running || generation !== this.generation) return;
    if (index >= PIPE_COUNT) {
      this.onStatus("Waiting for Discord");
      this.retryTimer = setTimeout(() => this.tryPipe(0, generation), this.retryMs);
      this.retryTimer.unref?.();
      return;
    }
    const socket = this.connect({
      path: pipePath(this.platform, this.runtimeDirectory, index),
    });
    this.socket = socket;
    this.ready = false;
    let buffer: Buffer = Buffer.alloc(0);
    socket.setTimeout(HANDSHAKE_TIMEOUT_MS);
    socket.on("timeout", () => socket.destroy());
    // Close drives the retry, including when Discord is not running.
    socket.on("error", () => {});
    socket.on("close", () => {
      if (!this.running || generation !== this.generation) return;
      if (this.ready) this.onStatus("Reconnecting to Discord");
      this.ready = false;
      this.socket = null;
      this.tryPipe(index + 1, generation);
    });
    socket.on("connect", () =>
      socket.write(encodeDiscordFrame(OPCODE_HANDSHAKE, { v: 1, client_id: this.config.clientId })),
    );
    socket.on("data", (chunk: Buffer) => {
      if (!this.running || generation !== this.generation) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= HEADER_BYTES) {
        const opcode = buffer.readUInt32LE(0);
        const length = buffer.readUInt32LE(4);
        if (length > MAX_FRAME_BYTES) return void socket.destroy();
        if (buffer.length < length + HEADER_BYTES) return;
        const body = buffer.subarray(HEADER_BYTES, length + HEADER_BYTES);
        buffer = buffer.subarray(length + HEADER_BYTES);
        let payload: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(body.toString("utf8"));
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return void socket.destroy();
          }
          payload = parsed as Record<string, unknown>;
        } catch {
          return void socket.destroy();
        }
        if (opcode === OPCODE_CLOSE) return void socket.destroy();
        if (opcode === OPCODE_PING) socket.write(encodeDiscordFrame(OPCODE_PONG, payload));
        if (opcode === OPCODE_FRAME && payload.evt === "READY") {
          socket.setTimeout(0);
          this.ready = true;
          this.lastActivity = "";
          this.lastPublishedAt = 0;
          this.publish();
        }
        if (opcode === OPCODE_FRAME && payload.cmd === "SET_ACTIVITY") {
          if (payload.evt === "ERROR") {
            // A presence is only claimed once Discord acknowledges it.
            this.ready = false;
            this.onStatus("Discord rejected activity: check Application ID");
            return void socket.destroy();
          }
          socket.setTimeout(0);
          this.onStatus("Connected");
        }
      }
    });
  }

  private publish(): void {
    const socket = this.socket;
    if (!this.ready || !socket || socket.destroyed) return;
    const activity = createDiscordActivity(
      this.config,
      this.context,
      this.startedAt,
      this.presence,
    );
    const serialized = JSON.stringify(activity);
    if (serialized === this.lastActivity) return;
    const delay = Math.max(0, MIN_PUBLISH_INTERVAL_MS - (Date.now() - this.lastPublishedAt));
    if (delay > 0) {
      if (!this.publishTimer) {
        this.publishTimer = setTimeout(() => {
          this.publishTimer = null;
          this.publish();
        }, delay);
        this.publishTimer.unref?.();
      }
      return;
    }
    this.lastActivity = serialized;
    this.lastPublishedAt = Date.now();
    socket.setTimeout(ACTIVITY_TIMEOUT_MS);
    socket.write(
      encodeDiscordFrame(OPCODE_FRAME, {
        cmd: "SET_ACTIVITY",
        nonce: NodeCrypto.randomUUID(),
        args: { pid: process.pid, activity },
      }),
    );
  }
}
