import { OrchestratorMcpFailure, TrimmedNonEmptyString } from "@t3tools/contracts";
import {
  PROJECT_PROPOSAL_MAX_NAME_LENGTH,
  PROPOSE_PROJECT_TOOL_NAME,
  SEND_TO_USER_MAX_LENGTH,
  SEND_TO_USER_TOOL_NAME,
} from "@t3tools/shared/toolOutput";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

// Claude 5.1+ returns text written before a tool call only as a short summary; tool input arrives intact.
// It affects only the caller's thread, so read-only sandboxes and plan mode may use it.
const SendToUserTool = Tool.make(SEND_TO_USER_TOOL_NAME, {
  description:
    "Show the user a Markdown message in this thread, exactly as written, before your turn ends. Use it for content the user must read in full mid-turn, such as a draft, a code block, or what a question you are about to ask refers to. Don't repeat it in your reply.",
  parameters: Schema.Struct({
    message: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(SEND_TO_USER_MAX_LENGTH),
    ).annotate({ description: "Markdown, shown verbatim." }),
  }),
  success: Schema.Struct({
    sentMessage: Schema.String,
    message: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
})
  .annotate(Tool.Title, "Send a message to the user")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients)
  // Claude Code defers MCP tools behind ToolSearch; Anthropic says to declare this from the first request.
  .annotate(Tool.Meta, { "anthropic/alwaysLoad": true });

// It only shows the user a question; nothing changes until they answer, so read-only sandboxes may use it.
const ProposeProjectTool = Tool.make(PROPOSE_PROJECT_TOOL_NAME, {
  description:
    "In a chat without a project, ask the user whether to turn it into a project, once the work is a real software project (new app, repository or multi-file codebase). Pass a fitting `name`, then carry on. If they agree, the thread moves with its history into a new folder.",
  parameters: Schema.Struct({
    name: TrimmedNonEmptyString.check(
      Schema.isMaxLength(PROJECT_PROPOSAL_MAX_NAME_LENGTH),
    ).annotate({
      description: "Project and folder name, e.g. `Pinball Stats`.",
    }),
  }),
  success: Schema.Struct({
    projectProposal: Schema.Struct({ name: Schema.String }),
    message: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ManagedProjectFolders.ManagedProjectFolders,
  ],
})
  .annotate(Tool.Title, "Propose a project to the user")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const MessageToolkit = Toolkit.make(SendToUserTool, ProposeProjectTool);
