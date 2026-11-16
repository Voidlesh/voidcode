import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { MessageToolkit } from "./tools.ts";

const handlers = {
  send_to_user: McpToolAccess.actsAsCaller((input) =>
    Effect.succeed({
      sentMessage: input.message,
      message: "Shown to the user. Don't repeat it.",
    }),
  ),
  propose_project: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
      const inChats = caller !== undefined && (yield* folders.isScratchProject(caller.projectId));
      if (!inChats)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message:
            "This thread already belongs to a project, so there is nothing to propose. Carry on with the task.",
        });
      return {
        projectProposal: { name: input.name },
        message:
          "The user is being asked. Don't create the project or its folder yourself; carry on with the task.",
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof MessageToolkit.tools>;

export const layer = McpToolAccess.toLayer(MessageToolkit, handlers);
