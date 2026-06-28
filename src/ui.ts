import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { Input, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { matchesSidequestQuakeKey, sidequestQuakeKeyHint } from "./config.ts";
import { oneLine } from "./context.ts";
import { renderMarkdownLines } from "./markdown.ts";
import { SidequestStore } from "./store.ts";
import type { AskInSidequest, SidequestMode, SidequestResult } from "./types.ts";

function padAnsi(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function isEnterKey(data: string): boolean {
  return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\r" || data === "\n";
}

const WORKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function workingFrame(frame: number): string {
  return WORKING_FRAMES[frame % WORKING_FRAMES.length] ?? "⠹";
}

function workingLabel(frame: number): string {
  return `${workingFrame(frame)} Working...`;
}

export class InlineForkSidequest implements Component, Focusable {
  private readonly input = new Input();
  private readonly unsubscribe: () => void;
  private _focused = false;
  private mode: SidequestMode = "prompt";
  private detail: { target: "root" | string; scroll: number } | undefined;
  private pendingDeleteTarget: string | undefined;
  private workingFrameIndex = 0;
  private readonly animationTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly store: SidequestStore,
    private readonly askInSidequest: AskInSidequest,
    private readonly quakeKeys: string[],
    private readonly done: (result: SidequestResult) => void,
  ) {
    this.input.setValue(store.draft);
    this.input.onSubmit = () => this.submitDraft();

    this.unsubscribe = store.subscribe(() => {
      this.syncInputFocus();
      this.tui.requestRender();
    });
    this.animationTimer = setInterval(() => {
      if (!this.store.hasActiveRun()) return;
      this.workingFrameIndex = (this.workingFrameIndex + 1) % WORKING_FRAMES.length;
      this.tui.requestRender();
    }, 120);
    (this.animationTimer as any).unref?.();
    this.syncInputFocus();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncInputFocus();
  }

  private syncInputFocus(): void {
    this.input.focused = this._focused && this.mode === "prompt" && this.detail === undefined && this.pendingDeleteTarget === undefined;
  }

  private close(): void {
    this.store.draft = this.input.getValue();
    this.done({ action: "close" });
  }

  private clearInput(): void {
    this.input.setValue("");
    this.store.draft = "";
    this.syncInputFocus();
    this.tui.requestRender();
  }

  private submitDraft(): void {
    const question = this.input.getValue().trim();
    if (!question) return;
    this.store.startQuestion(question, this.askInSidequest);
    this.input.setValue(this.store.draft);
    this.store.draft = this.input.getValue();
    this.syncInputFocus();
    this.tui.requestRender();
  }

  private moveSelection(delta: number): void {
    this.store.selectDelta(delta);
    this.syncInputFocus();
  }

  private openDetail(): void {
    const target = this.store.selectedNodeId ?? "root";
    this.detail = { target, scroll: 0 };
    if (target !== "root") this.store.markRead(target);
    this.syncInputFocus();
    this.tui.requestRender();
  }

  private fixedMainHeight(): number {
    return Math.max(18, Math.min(34, this.tui.terminal.rows - 3));
  }

  private closeDetail(): void {
    this.detail = undefined;
    this.syncInputFocus();
    this.tui.requestRender();
  }

  private scrollDetail(delta: number): void {
    if (!this.detail) return;
    this.detail.scroll = Math.max(0, this.detail.scroll + delta);
    this.tui.requestRender();
  }

  private requestDelete(target: string | null | undefined): void {
    if (!target) return;
    this.pendingDeleteTarget = target;
    this.syncInputFocus();
    this.tui.requestRender();
  }

  private cancelDelete(): void {
    this.pendingDeleteTarget = undefined;
    this.syncInputFocus();
    this.tui.requestRender();
  }

  private confirmDelete(): void {
    const target = this.pendingDeleteTarget;
    if (!target) return;
    const wasDetailTarget = this.detail?.target === target;
    this.pendingDeleteTarget = undefined;
    this.store.deleteNode(target);
    this.syncInputFocus();
    if (wasDetailTarget) {
      this.closeDetail();
    } else {
      this.tui.requestRender();
    }
  }

  private handlePendingDeleteInput(data: string): boolean {
    if (!this.pendingDeleteTarget) return false;

    if (matchesKey(data, "escape") || data === "n" || data === "N") {
      this.cancelDelete();
      return true;
    }

    if (isEnterKey(data) || matchesKey(data, "delete") || matchesKey(data, "backspace") || data === "y" || data === "Y") {
      this.confirmDelete();
      return true;
    }

    return true;
  }

  handleInput(data: string): void {
    if (matchesSidequestQuakeKey(data, this.quakeKeys)) {
      this.close();
      return;
    }

    if (this.handlePendingDeleteInput(data)) return;

    if (matchesKey(data, "ctrl+k")) {
      const target = this.detail?.target !== "root" ? this.detail?.target : this.store.selectedNodeId;
      const cancelTargetId = this.store.getCancelTargetId(target ?? undefined);
      if (cancelTargetId) {
        this.store.abortActiveRun(cancelTargetId);
        this.mode = "prompt";
        this.syncInputFocus();
        this.tui.requestRender();
        return;
      }
    }

    if (this.detail) {
      if ((matchesKey(data, "delete") || matchesKey(data, "backspace")) && this.detail.target !== "root") {
        this.requestDelete(this.detail.target);
        return;
      }
      if (matchesKey(data, "escape") || matchesKey(data, "left")) {
        this.closeDetail();
        return;
      }
      if (matchesKey(data, "ctrl+c")) {
        this.close();
        return;
      }
      if (matchesKey(data, "up")) {
        this.scrollDetail(-1);
        return;
      }
      if (matchesKey(data, "down")) {
        this.scrollDetail(1);
        return;
      }
      if (matchesKey(data, "pageUp")) {
        this.scrollDetail(-10);
        return;
      }
      if (matchesKey(data, "pageDown")) {
        this.scrollDetail(10);
        return;
      }
      return;
    }

    if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
      this.mode = this.mode === "prompt" ? "select" : "prompt";
      this.syncInputFocus();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "escape")) {
      this.close();
      return;
    }

    if (matchesKey(data, "ctrl+c")) {
      this.clearInput();
      return;
    }

    if (matchesKey(data, "ctrl+u")) {
      this.store.toggleShowRead();
      return;
    }

    if (matchesKey(data, "ctrl+r")) {
      this.store.selectRoot();
      this.syncInputFocus();
      return;
    }

    if (this.mode === "select") {
      if (matchesKey(data, "delete") || matchesKey(data, "backspace")) {
        this.requestDelete(this.store.selectedNodeId);
        return;
      }

      if (matchesKey(data, "up")) {
        this.moveSelection(-1);
        return;
      }

      if (matchesKey(data, "down")) {
        this.moveSelection(1);
        return;
      }

      if (isEnterKey(data)) {
        this.openDetail();
        return;
      }

      return;
    }

    if (isEnterKey(data)) {
      this.submitDraft();
      return;
    }

    this.input.handleInput(data);
    this.store.draft = this.input.getValue();
    this.tui.requestRender();
  }

  render(width: number): string[] {
    if (width < 12) return [truncateToWidth("sidequest", width)];
    if (this.detail) return this.renderDetail(width);

    const th = this.theme;
    const inner = Math.max(1, width - 2);
    const border = (s: string) => th.fg("border", s);
    const line = (content = "") => border("│") + padAnsi(content, inner) + border("│");
    const selectedLine = (content = "") => border("│") + th.bg("selectedBg", padAnsi(content, inner)) + border("│");
    const promptSectionLine = (content = "") => (this.mode === "prompt" ? selectedLine(content) : line(content));
    const rowLine = (content: string, selected: boolean) => (this.mode === "select" || selected ? selectedLine(content) : line(content));
    const borderRule = (left: string, right: string, label?: string) => {
      if (!label) return border(left + "─".repeat(inner) + right);
      const labelWidth = visibleWidth(label);
      if (inner <= labelWidth + 1) return border(left + "─".repeat(inner) + right);
      return border(left + "─".repeat(inner - labelWidth - 1)) + th.fg("dim", label) + border("─" + right);
    };
    const topBorder = (label?: string) => borderRule("╭", "╮", label);
    const divider = (label?: string) => borderRule("├", "┤", label);
    const selected = this.store.getNode(this.store.selectedNodeId);
    const fixedHeight = this.fixedMainHeight();
    const nextQuestionId = this.store.nextQuestionId();
    const promptLabelText = nextQuestionId.toUpperCase();
    const inputMarker = " ";
    const inputWidth = Math.max(1, inner - visibleWidth(inputMarker) - visibleWidth(promptLabelText) - 1);
    const inputLine = this.input.render(inputWidth)[0] ?? "";
    const inputLabel = this.mode === "prompt" ? th.fg("accent", promptLabelText) : th.fg("muted", promptLabelText);
    const promptContent = `${inputMarker}${inputLabel} ${inputLine}`;
    const bottomLines = [
      divider(this.mode === "select" ? "[tab]" : undefined),
      promptSectionLine(promptContent),
      border("╰" + "─".repeat(inner) + "╯"),
    ];
    const maxTopLines = Math.max(0, fixedHeight - bottomLines.length);
    const pendingDeleteLines = 0;
    const remainingTopLines = (reserve = 0) => Math.max(0, maxTopLines - lines.length - pendingDeleteLines - reserve);
    const appendMarkdownPreview = (text: string, budget: number) => {
      if (budget <= 0) return;
      const rendered = renderMarkdownLines(text, Math.max(10, inner - 4));
      const truncated = rendered.length > budget;
      const bodyCount = truncated && budget > 1 ? budget - 1 : budget;
      for (const renderedLine of rendered.slice(0, bodyCount)) {
        lines.push(line(` ${renderedLine}`));
      }
      if (truncated && budget > 0) lines.push(line(th.fg("dim", " …")));
    };

    const lines: string[] = [];
    lines.push(topBorder());
    lines.push(line(th.fg("accent", th.bold(" Sidequest "))));
    lines.push(divider(this.mode === "prompt" ? "[tab]" : undefined));

    const displayNodes = this.store.getDisplayNodes();
    const selectedIndex = this.store.selectedIndex();
    const visibleRows = 10;
    const totalRows = displayNodes.length + 1; // root + grouped sidequest questions
    const start = Math.max(0, Math.min(selectedIndex - Math.floor(visibleRows / 2), totalRows - visibleRows));
    const end = Math.min(totalRows, start + visibleRows);

    for (let row = start; row < end; row++) {
      if (row === 0) {
        const isSelected = this.store.selectedNodeId === null;
        const marker = isSelected ? th.fg("accent", "› ") : "  ";
        const label = isSelected ? th.fg("text", "root — active session") : th.fg("dim", "root — active session");
        lines.push(rowLine(`${marker}${th.fg("accent", "◇ root")} ${label}`, isSelected && this.mode === "select"));
        continue;
      }

      const node = displayNodes[row - 1]!;
      const isSelected = node.id === this.store.selectedNodeId;
      const depth = Math.min(1, this.store.getDepth(node));
      const branch = "  ".repeat(depth) + (depth > 0 ? "↳ " : "");
      const marker = isSelected ? th.fg("accent", "› ") : "  ";
      const status =
        node.status === "loading"
          ? th.fg("warning", this.store.isNodeRunning(node.id) ? workingFrame(this.workingFrameIndex) : "•")
          : node.status === "error"
            ? th.fg("error", "✗")
            : th.fg("success", "✓");
      if (this.pendingDeleteTarget === node.id) {
        const deletesFollowUps = node.parentId === null && this.store.nodes.some((candidate) => candidate.parentId === node.id);
        const prompt = `${marker}${th.fg("warning", "Delete?")} ${th.fg("text", `${node.id}${deletesFollowUps ? " + follow-ups" : ""}`)} ${th.fg("dim", "Enter/Y · Esc/N")}`;
        lines.push(rowLine(truncateToWidth(prompt, inner, "…"), true));
        continue;
      }

      const unread = node.status !== "loading" && !node.read;
      const unreadMark = unread ? th.fg("accent", "●") : " ";
      const question = th.fg(isSelected ? "text" : "dim", oneLine(node.question));
      const unreadRightPadding = 2;
      const left = truncateToWidth(`${marker}${branch}${status} ${th.fg("accent", node.id)} ${question}`, Math.max(1, inner - 1 - unreadRightPadding), "…");
      const spacing = " ".repeat(Math.max(0, inner - visibleWidth(left) - 1 - unreadRightPadding));
      lines.push(rowLine(`${left}${spacing}${unreadMark}${" ".repeat(unreadRightPadding)}`, isSelected && this.mode === "select"));
    }

    if (this.store.nodes.length === 0) {
      lines.push(rowLine(th.fg("muted", "  No sidequest questions yet. Root questions appear as Q1, Q2, Q3…"), false));
    }

    if (!selected) {
      lines.push(divider());
      lines.push(line(` ${th.fg("accent", "Root:")}`));
      lines.push(line(" Ask from here to start a fresh sidequest."));
      lines.push(line(" [tab] switches between ask and select."));
      lines.push(line(" Select a thread to ask a follow-up."));
    } else {
      lines.push(divider());
      lines.push(line(` ${th.fg("accent", "Q:")}`));
      const questionLines = renderMarkdownLines(selected.question, Math.max(10, inner - 4)).slice(0, 4);
      for (const questionLine of questionLines) {
        lines.push(line(` ${questionLine}`));
      }
      if (questionLines.length === 4) lines.push(line(th.fg("dim", " …")));
      if (remainingTopLines(0) > 0) lines.push(line());
      if (selected.status === "loading") {
        if (selected.answer) {
          const answerBudget = remainingTopLines(3); // blank + A: heading + working status
          if (answerBudget > 0) {
            lines.push(line(` ${th.fg("success", "A:")}`));
            appendMarkdownPreview(selected.answer, answerBudget);
            if (remainingTopLines(1) > 0) lines.push(line());
          }
        }
        lines.push(line(` ${th.fg("warning", workingLabel(this.workingFrameIndex))} ${th.fg("dim", "Ctrl+K to stop.")}`));
      } else if (selected.error) {
        lines.push(line(`${th.fg("error", "Error: ")} ${th.fg("text", selected.error)}`));
      } else if (selected.answer) {
        const answerBudget = remainingTopLines(1); // A: heading
        if (answerBudget > 0) {
          lines.push(line(` ${th.fg("success", "A:")}`));
          appendMarkdownPreview(selected.answer, answerBudget);
        }
      }
    }

    const topLines = lines.slice(0, maxTopLines);
    while (topLines.length < maxTopLines) topLines.push(line());
    return [...topLines, ...bottomLines];
  }

  private renderDetail(width: number): string[] {
    const th = this.theme;
    const inner = Math.max(1, width - 2);
    const contentWidth = Math.max(10, inner - 2);
    const border = (s: string) => th.fg("border", s);
    const line = (content = "") => border("│") + padAnsi(content, inner) + border("│");
    const divider = border("├" + "─".repeat(inner) + "┤");
    const detail = this.detail!;
    const content = this.buildDetailContent(contentWidth);
    const visibleCount = Math.max(6, Math.floor(this.tui.terminal.rows * 0.92) - 8);
    const maxScroll = Math.max(0, content.length - visibleCount);
    detail.scroll = Math.max(0, Math.min(detail.scroll, maxScroll));
    const visible = content.slice(detail.scroll, detail.scroll + visibleCount);

    const lines: string[] = [];
    lines.push(border("╭" + "─".repeat(inner) + "╮"));
    lines.push(line(th.fg("accent", th.bold(detail.target === "root" ? " Root context " : ` ${detail.target} detail `))));
    lines.push(line(th.fg("dim", " ↑↓/PgUp/PgDn scroll · ←/Esc returns · Delete deletes · Ctrl+K stop")));
    if (this.pendingDeleteTarget) {
      const pending = this.store.getNode(this.pendingDeleteTarget);
      const deletesFollowUps = pending?.parentId === null && this.store.nodes.some((node) => node.parentId === pending.id);
      lines.push(line(`${th.fg("warning", "Delete?")} ${th.fg("text", `${this.pendingDeleteTarget}${deletesFollowUps ? " and its follow-ups" : ""}`)}`));
      lines.push(line(th.fg("dim", " Enter/Y confirms · Esc/N cancels")));
    }
    lines.push(divider);

    for (const contentLine of visible) {
      lines.push(line(` ${contentLine}`));
    }

    lines.push(divider);
    lines.push(line(th.fg("dim", ` ${detail.scroll + 1}-${Math.min(content.length, detail.scroll + visibleCount)} / ${content.length} lines`)));
    lines.push(border("╰" + "─".repeat(inner) + "╯"));
    return lines;
  }

  private buildDetailContent(width: number): string[] {
    const th = this.theme;
    const detail = this.detail!;
    const out: string[] = [];
    const pushWrapped = (text: string, color: Parameters<Theme["fg"]>[0] = "text") => {
      const logicalLines = text.split("\n");
      for (const logicalLine of logicalLines) {
        if (!logicalLine) {
          out.push("");
          continue;
        }
        out.push(...wrapTextWithAnsi(th.fg(color, logicalLine), width));
      }
    };
    const pushMarkdown = (text: string) => {
      out.push(...renderMarkdownLines(text, width));
    };
    const pushHeading = (text: string) => {
      out.push(th.fg("accent", th.bold(text)));
    };

    if (detail.target === "root") {
      pushHeading("Root / active-session context");
      pushWrapped(`Grounding: ${this.store.contextInfo}`, "muted");
      pushWrapped(`Model for new sidequest questions: ${this.store.modelLabel}`, "muted");
      pushWrapped(`Tools for new sidequest questions: ${this.store.toolAllowlist}`, "muted");
      out.push("");
      pushWrapped("New questions from root become Q1, Q2, Q3… Follow-ups use the selected thread's prior Q/A.", "muted");
      out.push("");
      pushWrapped(this.store.activeSessionContext, "text");
      return out;
    }

    const node = this.store.getNode(detail.target);
    if (!node) {
      pushWrapped(`Missing sidequest node: ${detail.target}`, "error");
      return out;
    }

    pushHeading(`${node.id}`);
    pushWrapped(`Status: ${node.status}`, node.status === "error" ? "error" : node.status === "loading" ? "warning" : "success");
    out.push("");
    pushHeading("Question");
    pushMarkdown(node.question);
    out.push("");
    pushHeading("Answer");
    if (node.answer) {
      pushMarkdown(node.answer);
    } else if (node.error) {
      pushWrapped(node.error, "error");
    } else {
      pushWrapped(`${workingLabel(this.workingFrameIndex)} Answer is still running in the background. Ctrl+K stops it.`, "warning");
    }

    out.push("");
    pushHeading("Grounding snapshot for this question");
    const grounding = node.grounding;
    if (!grounding) {
      pushWrapped("No grounding snapshot was stored for this node.", "warning");
      return out;
    }

    pushWrapped(`Captured: ${grounding.timestamp}`, "muted");
    pushWrapped(`Model: ${grounding.model}`, "muted");
    pushWrapped(`Tools: ${grounding.tools}`, "muted");
    pushWrapped(`Active session: ${grounding.contextInfo}`, "muted");
    out.push("");
    pushHeading("Prior sidequest Q/A");
    pushWrapped(grounding.sidequestParentPath, "text");
    out.push("");
    pushHeading("Active session context snapshot");
    pushWrapped(grounding.activeSessionContext, "text");
    return out;
  }

  invalidate(): void {
    this.input.invalidate();
  }

  dispose(): void {
    this.store.draft = this.input.getValue();
    this.store.persist();
    clearInterval(this.animationTimer);
    this.unsubscribe();
    // Intentionally do NOT abort here. Esc/dismiss should hide the sidequest while
    // in-flight sidequest questions continue in the background.
  }
}
