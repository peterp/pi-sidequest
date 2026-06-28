import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { SessionContextItem, SidequestNode } from "./types.ts";

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block: any) => {
      if (block?.type === "text") return block.text ?? "";
      if (block?.type === "thinking") return `[thinking] ${block.thinking ?? ""}`;
      if (block?.type === "toolCall") return `[tool call: ${block.name ?? "unknown"}]`;
      if (block?.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function entryToContextItem(entry: SessionEntry): SessionContextItem | undefined {
  if (entry.type === "message") {
    const msg: any = entry.message;
    const role = msg.role ?? "message";
    const text = contentToText(msg.content);
    if (!text.trim()) return undefined;
    return { id: entry.id, label: role, text };
  }

  if (entry.type === "compaction") {
    return { id: entry.id, label: "compaction", text: entry.summary };
  }

  if (entry.type === "branch_summary") {
    return { id: entry.id, label: "branch summary", text: entry.summary };
  }

  if (entry.type === "custom_message") {
    const text = contentToText(entry.content);
    if (!text.trim()) return undefined;
    return { id: entry.id, label: `custom:${entry.customType}`, text };
  }

  return undefined;
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

export function buildActiveSessionContext(items: SessionContextItem[], maxChars = 40_000): string {
  const chunks = items.map((item, index) => {
    return `### ${index + 1}. ${item.label} ${item.id}\n${clipText(item.text.trim(), 3_000)}`;
  });

  const full = chunks.join("\n\n");
  if (full.length <= maxChars) return full || "(active session has no text messages yet)";
  return `[Earlier active session context truncated]\n\n${full.slice(full.length - maxChars)}`;
}

export function normalizeQuestionId(id: string | null | undefined): string | null {
  return id ? id.replace(/^q/i, "Q") : null;
}

export function buildSidequestPath(path: SidequestNode[]): string {
  if (path.length === 0) return "(no completed prior sidequest Q/A available; pending answers are skipped)";

  return path
    .map((node, index) => {
      const answer = node.answer ? clipText(node.answer, 4_000) : node.error ? `[error] ${node.error}` : "(no answer captured)";
      return `### ${index + 1}. ${node.id}\nUser question: ${node.question}\nSidequest answer: ${answer}`;
    })
    .join("\n\n");
}
