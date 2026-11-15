import * as NodeEvents from "node:events";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { DiscordRpcClient, encodeDiscordFrame, type DiscordSocket } from "./DiscordRpcClient.ts";

class FakeSocket extends NodeEvents.EventEmitter {
  writes: Buffer[] = [];
  destroyed = false;
  setTimeout() {}
  write(value: Buffer) {
    this.writes.push(value);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }
}

const payload = (buffer: Buffer) => JSON.parse(buffer.subarray(8).toString());

function setup(config?: unknown) {
  const sockets: FakeSocket[] = [];
  const paths: string[] = [];
  const statuses: string[] = [];
  const client = new DiscordRpcClient({
    platform: "win32",
    connect: ({ path }) => {
      paths.push(path);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as DiscordSocket;
    },
    onStatus: (status) => statuses.push(status),
  });
  client.start(config);
  return { client, sockets, statuses, paths };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DiscordRpcClient", () => {
  it("opens the Windows named pipe and stays idle when disabled", () => {
    const { client, sockets, paths } = setup();
    expect(paths[0]).toBe("\\\\?\\pipe\\discord-ipc-0");
    client.start({ enabled: false });
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.destroyed).toBe(true);
  });

  it("handshakes, reassembles a fragmented READY, waits for the acknowledgement, throttles updates and answers pings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { client, sockets, statuses } = setup();
    try {
      const socket = sockets[0]!;
      socket.emit("connect");
      expect(payload(socket.writes[0]!)).toEqual({ v: 1, client_id: "878349344737222696" });
      const ready = encodeDiscordFrame(1, { evt: "READY" });
      socket.emit("data", ready.subarray(0, 10));
      expect(socket.writes).toHaveLength(1);
      socket.emit("data", ready.subarray(10));
      const activity = payload(socket.writes[1]!);
      expect(activity.cmd).toBe("SET_ACTIVITY");
      expect(activity.args.pid).toBe(process.pid);
      expect(activity.args.activity.details).toBe("Exploring the workspace");
      expect(activity.args.activity.timestamps.start).toBe(client.startedAt);
      expect(statuses).not.toContain("Connected");
      socket.emit("data", encodeDiscordFrame(1, { cmd: "SET_ACTIVITY", data: {} }));
      expect(statuses.at(-1)).toBe("Connected");
      client.update({ idle: true });
      expect(socket.writes).toHaveLength(2);
      vi.advanceTimersByTime(15_000);
      expect(payload(socket.writes.at(-1)!).args.activity.details).toBe("Taking a break");
      const count = socket.writes.length;
      client.update({ idle: true });
      expect(socket.writes).toHaveLength(count);
      client.update({ background: true });
      vi.advanceTimersByTime(15_000);
      expect(payload(socket.writes.at(-1)!).args.activity.details).toBe(
        "Workspace running in background",
      );
      socket.emit("data", encodeDiscordFrame(3, { ping: true }));
      expect(socket.writes.at(-1)!.readUInt32LE(0)).toBe(4);
    } finally {
      client.stop();
    }
  });

  it("tries every pipe and cancels the scheduled reconnect on stop", () => {
    vi.useFakeTimers();
    const { client, sockets, statuses } = setup();
    for (let index = 0; index < 10; index++) sockets[index]!.destroy();
    expect(sockets).toHaveLength(10);
    expect(statuses.at(-1)).toBe("Waiting for Discord");
    client.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each<[string, Buffer]>([
    ["malformed JSON", Buffer.from([1, 0, 0, 0, 1, 0, 0, 0, 123])],
    ["null payload", encodeDiscordFrame(1, null)],
    ["array payload", encodeDiscordFrame(1, [])],
    ["rejected activity", encodeDiscordFrame(1, { cmd: "SET_ACTIVITY", evt: "ERROR" })],
  ])("moves on to the next pipe after %s", (_name, frame) => {
    const { client, sockets } = setup();
    try {
      sockets[0]!.emit("data", frame);
      expect(sockets[0]!.destroyed).toBe(true);
      expect(sockets).toHaveLength(2);
    } finally {
      client.stop();
    }
  });
});
