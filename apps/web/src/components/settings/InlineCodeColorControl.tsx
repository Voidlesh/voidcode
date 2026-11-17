import { useState } from "react";

import { CLAUDE_ORANGE_HEX, normalizeHexColor, writeInlineCodeColor } from "../../inlineCodeColor";
import { notifyThemeSaveFailure } from "../CommandPaletteThemeItems";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const FALLBACK_SWATCH = "#ffffff";
const FULL_HEX_PATTERN = /^#?[0-9a-f]{6}$/i;

export function InlineCodeColorControl({ color }: { color: string | null }) {
  // Text being typed; null while the field simply mirrors the stored colour.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? color ?? "";
  const isInvalid = text.trim() !== "" && normalizeHexColor(text) === null;

  const commit = (next: string | null) => {
    if (!writeInlineCodeColor(next)) notifyThemeSaveFailure();
  };

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <input
        type="color"
        aria-label="Pick inline code colour"
        className="size-7 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
        value={color ?? FALLBACK_SWATCH}
        onChange={(event) => commit(event.currentTarget.value)}
      />
      <Input
        size="sm"
        font="mono"
        className="w-28"
        aria-label="Inline code colour hex"
        aria-invalid={isInvalid}
        placeholder="#D97757"
        spellCheck={false}
        value={text}
        onChange={(event) => {
          const nextText = event.currentTarget.value;
          setDraft(nextText);
          // Only a full six-digit value applies live; "#D97" must not jump to "#dd9977" mid-typing.
          if (FULL_HEX_PATTERN.test(nextText.trim())) commit(nextText);
        }}
        onBlur={() => {
          const normalized = normalizeHexColor(text);
          if (text.trim() === "") commit(null);
          else if (normalized !== null) commit(normalized);
          setDraft(null);
        }}
      />
      <Button size="xs" variant="outline" onClick={() => commit(CLAUDE_ORANGE_HEX)}>
        Claude orange
      </Button>
    </div>
  );
}
