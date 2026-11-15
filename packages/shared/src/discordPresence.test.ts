import { describe, expect, it } from "vite-plus/test";

import {
  DISCORD_ARTWORK,
  createDiscordActivity,
  normalizeDiscordActivityContext,
  normalizeDiscordPresenceConfig,
} from "./discordPresence.ts";

describe("normalizeDiscordPresenceConfig", () => {
  it("migrates old config and bounds editable fields", () => {
    const config = normalizeDiscordPresenceConfig({
      enabled: false,
      clientId: "878349344737222696",
      idleMinutes: 500,
      detailsTemplate: "a".repeat(300),
      extra: "ignored",
    });
    expect(config.enabled).toBe(false);
    expect(config.largeImage).toBe(DISCORD_ARTWORK.t3);
    expect(config.idleMinutes).toBe(60);
    expect(config.detailsTemplate).toHaveLength(128);
    expect("extra" in config).toBe(false);
    expect(normalizeDiscordPresenceConfig(null).showThread).toBe(false);
  });

  it("accepts only public numeric application IDs", () => {
    expect(normalizeDiscordPresenceConfig().clientId).toBe("878349344737222696");
    for (const clientId of ["", "token", Number("878349344737222696"), "1".repeat(21)]) {
      expect(normalizeDiscordPresenceConfig({ clientId }).clientId).toBe("");
    }
  });

  it("filters image schemes and invalid button URLs but keeps Discord asset keys", () => {
    for (const bad of [
      "javascript:alert(1)",
      "file:///secret.png",
      "data:image/png;base64,a",
      "http://example.com/a.png",
      "https://user:password@example.com/a",
    ]) {
      expect(normalizeDiscordPresenceConfig({ largeImage: bad }).largeImage).toBe("");
      expect(normalizeDiscordPresenceConfig({ buttonUrl: bad }).buttonUrl).toBe("");
    }
    expect(normalizeDiscordPresenceConfig({ largeImage: "my_workspace" }).largeImage).toBe(
      "my_workspace",
    );
    expect(normalizeDiscordPresenceConfig({ smallImage: "" }).smallImage).toBe("");
  });
});

describe("createDiscordActivity", () => {
  it("respects project and thread sharing in every text field and custom mode", () => {
    const activity = createDiscordActivity(
      {
        showProject: false,
        showThread: false,
        mode: "custom",
        customActivity: "Making music",
        detailsTemplate: "{activity} · {project}",
        stateTemplate: "{thread} · {threads}",
        largeText: "{thread}",
        smallText: "{project}",
      },
      {
        activity: "working",
        project: "secret-project",
        thread: "Secret customer request",
        threads: 3,
      },
      100,
    );
    expect(activity.details).toBe("Making music · T3 Code");
    expect(activity.state).toBe("Private thread · 3");
    expect(activity.assets?.large_text).toBe("Private thread");
    expect(activity.assets?.small_text).toBe("T3 Code");
    expect(JSON.stringify(activity)).not.toContain("secret");
  });

  it("lets running work and input requests outrank idle and background", () => {
    const details = (activity: string, presence: { idle?: boolean; background?: boolean }) =>
      createDiscordActivity({}, { activity }, 10, presence).details;
    expect(details("working", { idle: true, background: true })).toBe("Agent is working");
    expect(details("input", { idle: true })).toBe("Waiting for input");
    expect(details("browsing", { idle: true })).toBe("Taking a break");
    expect(details("browsing", { background: true })).toBe("Workspace running in background");
  });

  it("serializes timer, images and buttons only when configured", () => {
    const minimal = createDiscordActivity(
      { showElapsed: false, largeImage: "", smallImage: "", stateTemplate: "" },
      {},
      100,
    );
    expect(minimal.timestamps).toBeUndefined();
    expect(minimal.assets).toBeUndefined();
    expect(minimal.buttons).toBeUndefined();
    expect(minimal.state).toBeUndefined();
    const full = createDiscordActivity(
      {
        buttonLabel: "Portfolio",
        buttonUrl: "https://example.com",
        secondButtonLabel: "Broken",
        secondButtonUrl: "file:///x",
        showThread: true,
        stateTemplate: "{thread}",
      },
      { thread: "My feature" },
      100,
    );
    expect(full.timestamps).toEqual({ start: 100 });
    expect(full.buttons).toEqual([{ label: "Portfolio", url: "https://example.com/" }]);
    expect(full.state).toBe("My feature");
  });
});

describe("normalizeDiscordActivityContext", () => {
  it("bounds thread count and falls back for unknown activities and agents", () => {
    expect(normalizeDiscordActivityContext({ threads: -5, activity: "unknown" })).toMatchObject({
      threads: 0,
      activity: "browsing",
      agent: "Agent",
    });
    expect(normalizeDiscordActivityContext({ agent: "Codex", threads: 5000 })).toMatchObject({
      agent: "Codex",
      threads: 999,
    });
  });
});
