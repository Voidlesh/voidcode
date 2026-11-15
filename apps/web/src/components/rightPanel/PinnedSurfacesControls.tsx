import { CheckIcon, EllipsisVertical, Pin } from "lucide-react";
import type { ComponentType, MouseEvent as ReactMouseEvent } from "react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "~/components/ui/menu";
import { useLocalStorage } from "~/hooks/useLocalStorage";

import {
  DEFAULT_PINNED_SURFACES,
  PINNED_SURFACES_STORAGE_KEY,
  isSurfacePinned,
  pinnedSurfaceActions,
  pinnedSurfacesSchema,
  sanitizePinnedSurfaces,
  surfaceKeyForLabel,
  toggleSurfacePinned,
} from "./pinnedSurfaces";

export interface PinnableSurfaceAction {
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly available: boolean;
  readonly onClick: () => void;
}

export function usePinnedSurfaces() {
  const [stored, setStored] = useLocalStorage(
    PINNED_SURFACES_STORAGE_KEY,
    DEFAULT_PINNED_SURFACES,
    pinnedSurfacesSchema,
  );
  const pinned = sanitizePinnedSurfaces(stored);
  const toggle = (key: string) => setStored((current) => toggleSurfacePinned(current, key));
  return { pinned, toggle };
}

export function PinnedSurfacesBar(props: {
  actions: readonly PinnableSurfaceAction[];
  pinned: readonly string[];
}) {
  const visible = pinnedSurfaceActions(props.actions, props.pinned);
  if (visible.length === 0) return null;
  return (
    <div
      className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]"
      role="group"
      aria-label="Pinned surfaces"
    >
      {visible.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.label}
            size="icon-xs"
            variant="ghost"
            className="shrink-0"
            title={action.label}
            aria-label={action.label}
            disabled={!action.available}
            onClick={(event: ReactMouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              action.onClick();
            }}
          >
            <Icon className="size-3.5" />
          </Button>
        );
      })}
      <div className="mx-[3px] h-3.5 w-px shrink-0 bg-border" aria-hidden />
    </div>
  );
}

export function PinnedSurfacesMenu(props: {
  actions: readonly PinnableSurfaceAction[];
  pinned: readonly string[];
  onToggle: (key: string) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            className="shrink-0"
            title="Configure pinned surfaces (tabs)"
            aria-label="Configure pinned surfaces (tabs)"
          />
        }
      >
        <EllipsisVertical className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom" sideOffset={6}>
        <MenuGroup>
          <MenuGroupLabel>Pinned to Topbar</MenuGroupLabel>
          {props.actions.map((action) => {
            const Icon = action.icon;
            const key = surfaceKeyForLabel(action.label);
            return (
              <MenuItem key={key} closeOnClick={false} onClick={() => props.onToggle(key)}>
                <Icon />
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                {isSurfacePinned(props.pinned, key) ? (
                  <CheckIcon className="text-primary" />
                ) : (
                  <Pin className="opacity-30" />
                )}
              </MenuItem>
            );
          })}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

export function SurfacePinIndicator() {
  return (
    <span className="ml-0.5 inline-flex shrink-0 items-center opacity-60">
      <Pin className="size-2.5" />
    </span>
  );
}
