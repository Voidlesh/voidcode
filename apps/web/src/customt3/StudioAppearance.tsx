import { CheckIcon, RotateCcwIcon, PaletteIcon, UploadIcon } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";

import "./studio.css";
import { StudioBanner } from "./StudioBanner";
import {
  STUDIO_DEFAULTS,
  STUDIO_PRESETS,
  type StudioHeight,
  type StudioPresetKey,
  type StudioSettings,
} from "./studioState";
import { updateStudioSettings, useStudioSettings, useStudioStorageError } from "./studioStore";

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 60_000_000;
const MAX_IMAGE_WIDTH = 1600;
const MAX_IMAGE_HEIGHT = 1000;
const MAX_IMAGE_DATA_LENGTH = 1_800_000;
const HEIGHTS: readonly StudioHeight[] = ["compact", "balanced", "immersive"];
const PRESET_ENTRIES = Object.entries(STUDIO_PRESETS) as [
  StudioPresetKey,
  (typeof STUDIO_PRESETS)[StudioPresetKey],
][];
type BooleanSetting = "enabled" | "glow" | "grain" | "motion" | "clock";

async function decodeBannerImage(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type))
    throw new Error("Choose a PNG, JPEG or WebP image.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Choose an image smaller than 12 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
      throw new Error("This image is too large. Choose an image under 60 megapixels.");
    }
    const scale = Math.min(1, MAX_IMAGE_WIDTH / bitmap.width, MAX_IMAGE_HEIGHT / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable. Please try another image.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/webp", 0.86);
    if (data.length > MAX_IMAGE_DATA_LENGTH) {
      throw new Error("This image has too much detail. Choose a smaller image.");
    }
    return data;
  } finally {
    bitmap.close();
  }
}

function StudioToggle({
  name,
  description,
  setting,
  settings,
}: {
  readonly name: string;
  readonly description: string;
  readonly setting: BooleanSetting;
  readonly settings: StudioSettings;
}) {
  const id = `ct3-${setting}`;
  return (
    <div className="ct3-option">
      <label htmlFor={id}>
        <span>{name}</span>
        <small>{description}</small>
      </label>
      <input
        id={id}
        className="ct3-toggle"
        type="checkbox"
        role="switch"
        checked={settings[setting]}
        onChange={(event) => updateStudioSettings({ [setting]: event.target.checked })}
      />
    </div>
  );
}

export function StudioAppearance() {
  const settings = useStudioSettings();
  const storageMessage = useStudioStorageError();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const uploadSequence = useRef(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks unmount so late image decodes do not set state
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the transient "saved" hint on a timer
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2200);
    return () => window.clearTimeout(timer);
  }, [saved]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- disarms the reset confirmation on a timer
  useEffect(() => {
    if (!resetArmed) return;
    const timer = window.setTimeout(() => setResetArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [resetArmed]);

  const cancelUpload = () => {
    uploadSequence.current += 1;
    setBusy(false);
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    uploadSequence.current += 1;
    const sequence = uploadSequence.current;
    const isCurrent = () => sequence === uploadSequence.current && mounted.current;
    setError("");
    setBusy(true);
    try {
      const image = await decodeBannerImage(file);
      if (isCurrent() && updateStudioSettings({ image })) setSaved(true);
    } catch (cause) {
      if (isCurrent()) {
        setError(cause instanceof Error ? cause.message : "Could not read this image.");
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };

  const choosePreset = (preset: StudioPresetKey) => {
    cancelUpload();
    setError("");
    updateStudioSettings({ preset, image: "" });
  };

  const reset = () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    cancelUpload();
    setError("");
    setResetArmed(false);
    updateStudioSettings(STUDIO_DEFAULTS);
  };

  const shownError = error || storageMessage;

  return (
    <section className="ct3-studio" aria-labelledby="ct3-studio-title" id="workspace-studio">
      <header className="ct3-section-header">
        <div>
          <div className="ct3-kicker">
            <PaletteIcon width={14} height={14} aria-hidden />
            A SPACE THAT FEELS LIKE YOU
          </div>
          <h2 id="ct3-studio-title">Workspace Studio</h2>
          <p>Give your workspace a little atmosphere. Keep your focus.</p>
        </div>
        <span className="ct3-badge">PERSONAL</span>
      </header>
      <StudioBanner preview />
      <div className="ct3-controls">
        <StudioToggle
          name="Workspace banner"
          description="A personal hero above your projects in the sidebar."
          setting="enabled"
          settings={settings}
        />
        <fieldset className="ct3-fieldset">
          <legend>Choose an atmosphere</legend>
          <div className="ct3-presets">
            {PRESET_ENTRIES.map(([key, preset]) => {
              const selected = key === settings.preset && !settings.image;
              const swatchStyle = {
                "--ct3-a": preset.colors[0],
                "--ct3-b": preset.colors[1],
                "--ct3-c": preset.colors[2],
              } as CSSProperties;
              return (
                <button
                  key={key}
                  type="button"
                  className="ct3-preset"
                  aria-pressed={selected}
                  onClick={() => choosePreset(key)}
                >
                  <span className="ct3-swatch" style={swatchStyle}>
                    {selected ? (
                      <span className="ct3-selected">
                        <CheckIcon width={12} height={12} aria-hidden />
                      </span>
                    ) : null}
                  </span>
                  <strong>{preset.name}</strong>
                  <small>{preset.description}</small>
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="ct3-upload-row">
          <div>
            <span className="ct3-label">Or make it yours</span>
            <p>Use your own image. Stored on this device.</p>
          </div>
          <div className="ct3-button-group">
            {settings.image ? (
              <button
                type="button"
                className="ct3-button ct3-quiet"
                onClick={() => {
                  cancelUpload();
                  updateStudioSettings({ image: "" });
                }}
              >
                Remove
              </button>
            ) : null}
            <button
              type="button"
              className="ct3-button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <UploadIcon width={14} height={14} aria-hidden />
              {busy ? "Processing…" : settings.image ? "Replace image" : "Upload image"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="ct3-file"
              tabIndex={-1}
              aria-label="Upload banner image"
              onChange={(event) => void upload(event)}
            />
          </div>
        </div>
        <div className="ct3-text-fields">
          <label>
            <span>Headline</span>
            <input
              type="text"
              value={settings.title}
              maxLength={80}
              onChange={(event) => updateStudioSettings({ title: event.target.value })}
              placeholder={STUDIO_DEFAULTS.title}
            />
          </label>
          <label>
            <span>A few words underneath</span>
            <input
              type="text"
              value={settings.subtitle}
              maxLength={140}
              onChange={(event) => updateStudioSettings({ subtitle: event.target.value })}
              placeholder="Optional subtitle"
            />
          </label>
        </div>
        <div className="ct3-size-row">
          <div>
            <span className="ct3-label">Banner height</span>
            <p>Find the right balance for your sidebar.</p>
          </div>
          <div className="ct3-segmented" role="group" aria-label="Banner height">
            {HEIGHTS.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={settings.height === size}
                onClick={() => updateStudioSettings({ height: size })}
              >
                {size.charAt(0).toUpperCase() + size.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="ct3-details-heading">
          <span>The small details</span>
          <span>SUBTLE BY DEFAULT</span>
        </div>
        <div className="ct3-details">
          <StudioToggle
            name="Soft glow"
            description="A gentle halo at the edge of the artwork."
            setting="glow"
            settings={settings}
          />
          <StudioToggle
            name="Fine grain"
            description="A soft, tactile finish over the artwork."
            setting="grain"
            settings={settings}
          />
          <StudioToggle
            name="Ambient motion"
            description="Slow-moving light. Respects reduced motion."
            setting="motion"
            settings={settings}
          />
          <StudioToggle
            name="Quiet clock"
            description="Your local time, tucked into the corner."
            setting="clock"
            settings={settings}
          />
        </div>
        <footer className="ct3-footer">
          <span className="ct3-save-status" role="status">
            <CheckIcon width={13} height={13} aria-hidden />
            {saved ? "Image saved to this device" : "Changes save automatically on this device"}
          </span>
          <button type="button" className="ct3-button ct3-quiet" onClick={reset}>
            <RotateCcwIcon width={13} height={13} aria-hidden />
            {resetArmed ? "Confirm reset" : "Reset Studio"}
          </button>
        </footer>
        {shownError ? (
          <p className="ct3-error" role="alert">
            {shownError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
