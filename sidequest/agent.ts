import { spawn } from "node:child_process";
import { getSidequestToolAllowlist, SIDEQUEST_WEB_TOOLS_EXTENSION } from "./config.ts";

function extractAssistantText(messages: any[]): string {
  return messages
    .filter((message) => message?.role === "assistant" && Array.isArray(message.content))
    .flatMap((message) => message.content)
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

export function runToolCapableSidequestAgent(options: {
  cwd: string;
  modelArg: string | undefined;
  prompt: string;
  signal: AbortSignal;
  onUpdate?: (partialAnswer: string) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const toolAllowlist = getSidequestToolAllowlist();
    const args = ["--mode", "rpc", "--no-session", "--no-extensions", "-e", SIDEQUEST_WEB_TOOLS_EXTENSION, "--tools", toolAllowlist];
    if (options.modelArg) args.push("--model", options.modelArg);

    const child = spawn("pi", args, {
      cwd: options.cwd,
      env: { ...process.env, PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK ?? "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    let buffer = "";
    let answer = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener("abort", onAbort);
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore cleanup errors
      }
      fn();
    };

    const onAbort = () => {
      try {
        child.stdin.write(`${JSON.stringify({ type: "abort" })}\n`);
      } catch {
        // ignore broken pipe, kill below
      }
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    };

    const handleEvent = (event: any) => {
      if (event?.type === "response" && event.command === "prompt" && event.success === false) {
        finish(() => reject(new Error(event.error ?? "Sidequest prompt was rejected.")));
        return;
      }

      if (event?.type === "message_update") {
        const update = event.assistantMessageEvent;
        if (update?.type === "text_delta" && typeof update.delta === "string") {
          answer += update.delta;
          options.onUpdate?.(answer);
        }
        return;
      }

      if (event?.type === "agent_end") {
        const finalText = Array.isArray(event.messages) ? extractAssistantText(event.messages).trim() : "";
        finish(() => resolve(finalText || answer.trim() || "(No answer returned.)"));
      }
    };

    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.trim()) continue;
        try {
          handleEvent(JSON.parse(line));
        } catch {
          // Ignore non-JSON noise from nested process.
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      if (settled) return;
      finish(() => {
        if (options.signal.aborted) {
          reject(new Error("Cancelled."));
          return;
        }
        reject(new Error(stderr.trim() || `Sidequest tool agent exited with code ${code ?? "unknown"}.`));
      });
    });

    child.stdin.write(`${JSON.stringify({ type: "prompt", message: options.prompt })}\n`);
  });
}
