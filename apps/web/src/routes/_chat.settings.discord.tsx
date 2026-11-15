import { createFileRoute } from "@tanstack/react-router";

import { DiscordSettingsPanel } from "../customt3/DiscordSettingsPanel";

export const Route = createFileRoute("/_chat/settings/discord")({
  component: DiscordSettingsPanel,
});
