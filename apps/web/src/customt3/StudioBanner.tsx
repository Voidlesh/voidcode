import { PaletteIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useNowMinute } from "~/hooks/useNowMinute";

import "./studio.css";
import { STUDIO_PRESETS, type StudioSettings } from "./studioState";
import { useStudioSettings } from "./studioStore";

type BannerStyle = CSSProperties & Record<`--ct3-${string}`, string>;

function StudioClock() {
  const time = new Date(`${useNowMinute()}Z`);
  return (
    <time dateTime={time.toISOString()}>
      {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}

export function StudioBanner({
  preview = false,
  value,
}: {
  readonly preview?: boolean;
  readonly value?: StudioSettings;
}) {
  const stored = useStudioSettings();
  const settings = value ?? stored;
  if (!preview && !settings.enabled) return null;

  const preset = STUDIO_PRESETS[settings.preset];
  const style: BannerStyle = {
    "--ct3-a": preset.colors[0],
    "--ct3-b": preset.colors[1],
    "--ct3-c": preset.colors[2],
    "--ct3-accent": preset.accent,
  };

  return (
    <section
      className={`ct3-banner ct3-${settings.height}${preview ? " ct3-preview" : " ct3-sidebar-banner"}`}
      aria-label={preview ? "Hero banner preview" : "Workspace banner"}
      data-motion={settings.motion}
      data-grain={settings.grain}
      data-glow={settings.glow}
      style={style}
    >
      {settings.image ? (
        <img className="ct3-image" src={settings.image} alt="" decoding="async" />
      ) : null}
      <div className="ct3-art" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="ct3-grid" aria-hidden />
      <div className="ct3-shade" aria-hidden />
      <div className="ct3-noise" aria-hidden />
      <div className="ct3-banner-content">
        <div className="ct3-eyebrow">
          <span className="ct3-status-dot" />
          YOUR WORKSPACE
          {settings.clock ? <StudioClock /> : <PaletteIcon width={13} height={13} aria-hidden />}
        </div>
        <h3>{settings.title.trim() || "Your next great idea starts here."}</h3>
        {settings.subtitle.trim() ? <p>{settings.subtitle}</p> : null}
        {preview ? (
          <div className="ct3-preview-note">
            <span>LIVE PREVIEW</span>
            <span>{settings.enabled ? "Visible in your sidebar" : "Banner is hidden"}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
