import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runToolCapableSidequestAgent } from "./agent.ts";
import {
  getSidequestQuakeKeys,
  getSidequestToolAllowlist,
  LEGACY_SIDECAR_STATE_CUSTOM_TYPE,
  LEGACY_SIDEQUEST_STATE_CUSTOM_TYPE,
  matchesSidequestQuakeKey,
  SIDEQUEST_STATE_CUSTOM_TYPE,
  SIDEQUEST_SYSTEM_PROMPT,
} from "./config.ts";
import { buildActiveSessionContext, buildSidequestPath, entryToContextItem } from "./context.ts";
import { SidequestStore } from "./store.ts";
import type { AskInSidequest, PersistedSidequestState, SessionContextItem, SidequestResult } from "./types.ts";
import { InlineForkSidequest } from "./ui.ts";

export default function (pi: ExtensionAPI) {
  const store = new SidequestStore((state) => pi.appendEntry(SIDEQUEST_STATE_CUSTOM_TYPE, state));
  let sidequestOpen = false;
  let unsubscribeQuakeKey: (() => void) | undefined;

  const openSidequest = async (ctx: ExtensionContext) => {
    if (sidequestOpen) return;
    if (ctx.mode !== "tui") {
      ctx.ui.notify("/sidequest requires interactive TUI mode", "error");
      return;
    }

    sidequestOpen = true;
    try {
      const contextItems = ctx.sessionManager
        .getBranch()
        .map(entryToContextItem)
        .filter((item): item is SessionContextItem => item !== undefined);

      const activeSessionContext = buildActiveSessionContext(contextItems);
      store.activeSessionContext = activeSessionContext;
      store.contextInfo = `${contextItems.length} active-branch item${contextItems.length === 1 ? "" : "s"} · leaf ${ctx.sessionManager.getLeafId() ?? "root"}`;
      store.modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model selected";
      store.toolAllowlist = getSidequestToolAllowlist();
      store.setStatusUpdater((text) => ctx.ui.setStatus("sidequest", text));

      const askInSidequest: AskInSidequest = async (question, priorPath, signal, onUpdate) => {
        const prompt = `${SIDEQUEST_SYSTEM_PROMPT}

Tool policy:
- Default sidequest tools are read-only repo tools plus internet tools: read, grep, find, ls, sidequest_web_search, sidequest_web_fetch.
- Use repo tools to verify repository facts when useful.
- Use sidequest_web_search and sidequest_web_fetch for current public internet information when useful.
- Do not modify files or the main pi session.
- Label facts by source: conversation-grounded, repo-verified, or web-verified. Cite URLs for web-verified facts.
- If the available tools are insufficient, say so.

## Active pi session context (read-only grounding)

${activeSessionContext}

## Prior sidequest Q/A (selected sidequest thread, not in main session)

${buildSidequestPath(priorPath)}

## New user-entered sidequest question

${question}`;

        return runToolCapableSidequestAgent({
          cwd: ctx.cwd,
          modelArg: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
          prompt,
          signal,
          onUpdate,
        });
      };

      const quakeKeys = getSidequestQuakeKeys();

      await ctx.ui.custom<SidequestResult>(
        (tui, theme, _keybindings, done) => new InlineForkSidequest(tui, theme, store, askInSidequest, quakeKeys, done),
        {
          overlay: true,
          overlayOptions: {
            anchor: "right-center",
            width: "42%",
            minWidth: 54,
            maxHeight: "92%",
            margin: { right: 1 },
            visible: (terminalWidth) => terminalWidth >= 80,
          },
        },
      );
    } finally {
      sidequestOpen = false;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    let latest: PersistedSidequestState | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (
        entry.type === "custom" &&
        (entry.customType === SIDEQUEST_STATE_CUSTOM_TYPE ||
          entry.customType === LEGACY_SIDEQUEST_STATE_CUSTOM_TYPE ||
          entry.customType === LEGACY_SIDECAR_STATE_CUSTOM_TYPE)
      ) {
        const data = entry.data as Partial<PersistedSidequestState> | undefined;
        if (data?.version === 1 && Array.isArray(data.nodes)) {
          latest = data as PersistedSidequestState;
        }
      }
    }
    store.restore(latest);
    store.setStatusUpdater((text) => ctx.ui.setStatus("sidequest", text));

    unsubscribeQuakeKey?.();
    if (ctx.mode === "tui") {
      const quakeKeys = getSidequestQuakeKeys();
      unsubscribeQuakeKey = ctx.ui.onTerminalInput((data) => {
        if (matchesSidequestQuakeKey(data, quakeKeys)) {
          const wasOpen = sidequestOpen;
          if (!wasOpen) void openSidequest(ctx);
          // If the sidequest is already open, do not consume; its component treats
          // the configured Quake key as a Quake-style hide key.
          return wasOpen ? undefined : { consume: true };
        }
        return undefined;
      });
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    unsubscribeQuakeKey?.();
    unsubscribeQuakeKey = undefined;
    ctx.ui.setStatus("sidequest", undefined);
    store.setStatusUpdater(undefined);
  });

  const sidequestCommand = {
    description: "Open an inline sidequest grounded in the active session",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await openSidequest(ctx);
    },
  };

  pi.registerCommand("sidequest", sidequestCommand);
}
