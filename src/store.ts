import { getSidequestToolAllowlist } from "./config.ts";
import { buildSidequestPath, normalizeQuestionId } from "./context.ts";
import type { AskInSidequest, PersistedSidequestState, RenderListener, SidequestNode, StatusUpdater } from "./types.ts";

export class SidequestStore {
  readonly nodes: SidequestNode[] = [];
  selectedNodeId: string | null = null;
  draft = "";
  showRead = true;
  contextInfo = "No active session context captured yet.";
  activeSessionContext = "(active session context has not been captured yet)";
  modelLabel = "unknown model";
  toolAllowlist = getSidequestToolAllowlist();

  private listeners = new Set<RenderListener>();
  private activeRuns = new Map<string, AbortController>();
  private statusUpdater: StatusUpdater | undefined;

  constructor(private readonly persistState?: (state: PersistedSidequestState) => void) {}

  setStatusUpdater(updater: StatusUpdater | undefined): void {
    this.statusUpdater = updater;
    this.updateStatus();
  }

  clearStatus(): void {
    this.statusUpdater?.(undefined);
  }

  private updateStatus(): void {
    if (!this.statusUpdater) return;
    if (this.activeRuns.size === 0) {
      this.statusUpdater(undefined);
      return;
    }

    const ids = [...this.activeRuns.keys()];
    const suffix = ids.length === 1 ? ids[0]! : `${ids.length} loading: ${ids.join(", ")}`;
    this.statusUpdater(`sidequest: ${suffix}`);
  }

  exportState(): PersistedSidequestState {
    return {
      version: 1,
      nodes: this.nodes,
      selectedNodeId: this.selectedNodeId,
      draft: this.draft,
      showRead: this.showRead,
    };
  }

  persist(): void {
    this.persistState?.(this.exportState());
  }

  restore(state: PersistedSidequestState | undefined): void {
    this.abortAllRuns();
    const restoredNodes = (state?.nodes ?? []).map((node: any) => ({
      ...node,
      id: normalizeQuestionId(node.id) ?? node.id,
      parentId: normalizeQuestionId(node.parentId),
      grounding: node.grounding
        ? {
            ...node.grounding,
            sidequestParentPath: node.grounding.sidequestParentPath ?? node.grounding.sidecarParentPath ?? "",
          }
        : undefined,
    })) as SidequestNode[];
    for (const node of restoredNodes) {
      if (node.status === "loading") {
        node.status = "error";
        node.error = "Interrupted before completion.";
      }
      node.read ??= node.status !== "loading";
    }

    this.nodes.splice(0, this.nodes.length, ...restoredNodes);
    this.showRead = state?.showRead ?? true;
    const selectedNodeId = normalizeQuestionId(state?.selectedNodeId);
    this.selectedNodeId = selectedNodeId && this.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null;
    if (this.selectedNodeId && !this.showRead && this.getNode(this.selectedNodeId)?.read) this.selectedNodeId = null;
    this.draft = state?.draft ?? "";
    this.updateStatus();
    this.notify();
  }

  subscribe(listener: RenderListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  hasActiveRun(): boolean {
    return this.activeRuns.size > 0;
  }

  isNodeRunning(nodeId: string): boolean {
    return this.activeRuns.has(nodeId);
  }

  getCancelTargetId(preferredNodeId?: string | null): string | undefined {
    return preferredNodeId && this.activeRuns.has(preferredNodeId) ? preferredNodeId : [...this.activeRuns.keys()].at(-1);
  }

  abortActiveRun(preferredNodeId?: string): void {
    const nodeId = this.getCancelTargetId(preferredNodeId);
    if (!nodeId) return;
    this.activeRuns.get(nodeId)?.abort();
    this.updateStatus();
    this.notify();
  }

  abortAllRuns(): void {
    for (const controller of this.activeRuns.values()) controller.abort();
    this.updateStatus();
    this.notify();
  }

  getNode(id: string | null): SidequestNode | undefined {
    if (!id) return undefined;
    return this.nodes.find((node) => node.id === id);
  }

  getDepth(node: SidequestNode): number {
    return node.parentId === null ? 0 : 1;
  }

  getRootId(nodeId: string | null): string | null {
    if (!nodeId) return null;
    const node = this.getNode(nodeId);
    if (!node) return null;
    return node.parentId ?? node.id;
  }

  getThreadNodes(rootId: string | null): SidequestNode[] {
    if (!rootId) return [];
    return this.nodes.filter((node) => node.id === rootId || node.parentId === rootId);
  }

  getCompletedThreadNodes(rootId: string | null): SidequestNode[] {
    return this.getThreadNodes(rootId).filter((node) => node.status !== "loading");
  }

  pendingContextCount(targetId: string | null): number {
    const rootId = this.getRootId(targetId);
    return this.getThreadNodes(rootId).filter((node) => node.status === "loading").length;
  }

  getDisplayNodes(): SidequestNode[] {
    const display: SidequestNode[] = [];
    const include = (node: SidequestNode) => this.showRead || !node.read || node.status === "loading" || node.id === this.selectedNodeId;
    for (const root of this.nodes.filter((node) => node.parentId === null)) {
      if (include(root)) display.push(root);
      display.push(...this.nodes.filter((node) => node.parentId === root.id && include(node)));
    }
    return display;
  }

  toggleShowRead(): void {
    this.showRead = !this.showRead;
    if (this.selectedNodeId && !this.showRead && this.getNode(this.selectedNodeId)?.read) this.selectedNodeId = null;
    this.persist();
    this.notify();
  }

  markRead(nodeId: string | null | undefined): void {
    if (!nodeId) return;
    const node = this.getNode(nodeId);
    if (!node || node.read) return;
    node.read = true;
    this.persist();
    this.notify();
  }

  selectedIndex(): number {
    if (!this.selectedNodeId) return 0; // root is the first selectable row
    const nodeIndex = this.getDisplayNodes().findIndex((node) => node.id === this.selectedNodeId);
    return nodeIndex < 0 ? 0 : nodeIndex + 1;
  }

  selectDelta(delta: number): void {
    const displayNodes = this.getDisplayNodes();
    const current = this.selectedIndex();
    const next = Math.max(0, Math.min(displayNodes.length, current + delta));
    this.selectedNodeId = next === 0 ? null : displayNodes[next - 1]!.id;
    const selected = this.getNode(this.selectedNodeId);
    if (selected && selected.status !== "loading" && !selected.read) {
      selected.read = true;
      this.persist();
    }
    this.notify();
  }

  selectRoot(): void {
    this.selectedNodeId = null;
    this.notify();
  }

  nextQuestionId(targetId: string | null = this.selectedNodeId): string {
    const rootId = normalizeQuestionId(this.getRootId(targetId));
    if (!rootId) {
      const maxRoot = this.nodes
        .filter((node) => node.parentId === null)
        .map((node) => /^Q(\d+)$/i.exec(node.id)?.[1])
        .filter((value): value is string => value !== undefined)
        .reduce((max, value) => Math.max(max, Number.parseInt(value, 10)), 0);
      return `Q${maxRoot + 1}`;
    }

    const escapedRoot = rootId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const followUpPattern = new RegExp(`^${escapedRoot}\\.(\\d+)$`);
    const maxFollowUp = this.nodes
      .filter((node) => node.parentId === rootId)
      .map((node) => followUpPattern.exec(node.id)?.[1])
      .filter((value): value is string => value !== undefined)
      .reduce((max, value) => Math.max(max, Number.parseInt(value, 10)), 0);
    return `${normalizeQuestionId(rootId) ?? rootId}.${maxFollowUp + 1}`;
  }

  private allocateNodeId(targetId: string | null): string {
    return this.nextQuestionId(targetId);
  }

  deleteNode(nodeId: string | null): boolean {
    if (!nodeId) return false;
    const target = this.getNode(nodeId);
    if (!target) return false;

    const before = this.getDisplayNodes();
    const beforeIndex = before.findIndex((node) => node.id === nodeId);
    const deleteIds = new Set<string>([target.id]);
    if (target.parentId === null) {
      for (const child of this.nodes.filter((node) => node.parentId === target.id)) {
        deleteIds.add(child.id);
      }
    }

    for (const id of deleteIds) {
      this.activeRuns.get(id)?.abort();
      this.activeRuns.delete(id);
    }

    const kept = this.nodes.filter((node) => !deleteIds.has(node.id));
    this.nodes.splice(0, this.nodes.length, ...kept);

    const after = this.getDisplayNodes();
    if (after.length === 0) {
      this.selectedNodeId = null;
    } else {
      const nextIndex = Math.max(0, Math.min(beforeIndex < 0 ? 0 : beforeIndex, after.length - 1));
      this.selectedNodeId = after[nextIndex]!.id;
    }

    this.updateStatus();
    this.persist();
    this.notify();
    return true;
  }

  startQuestion(question: string, askInSidequest: AskInSidequest): void {
    const targetId = this.selectedNodeId;
    const rootId = normalizeQuestionId(this.getRootId(targetId));
    const priorPath = this.getCompletedThreadNodes(rootId);
    const node: SidequestNode = {
      id: this.allocateNodeId(targetId),
      parentId: rootId,
      question,
      status: "loading",
      read: false,
      grounding: {
        contextInfo: this.contextInfo,
        activeSessionContext: this.activeSessionContext,
        sidequestParentPath: buildSidequestPath(priorPath),
        model: this.modelLabel,
        tools: this.toolAllowlist,
        timestamp: new Date().toISOString(),
      },
    };

    this.nodes.push(node);
    this.selectedNodeId = node.id;
    this.draft = "";

    const controller = new AbortController();
    this.activeRuns.set(node.id, controller);
    this.updateStatus();

    askInSidequest(question, priorPath, controller.signal, (partialAnswer) => {
      node.answer = partialAnswer;
      node.read = this.selectedNodeId === node.id;
      this.notify();
    })
      .then((answer) => {
        node.answer = answer.trim() || "(No answer returned.)";
        node.status = "done";
        node.read = this.selectedNodeId === node.id;
        this.persist();
      })
      .catch((err: unknown) => {
        node.error = controller.signal.aborted ? "Cancelled." : err instanceof Error ? err.message : String(err);
        node.status = "error";
        node.read = this.selectedNodeId === node.id;
        this.persist();
      })
      .finally(() => {
        if (this.activeRuns.get(node.id) === controller) this.activeRuns.delete(node.id);
        this.updateStatus();
        this.notify();
      });

    this.persist();
    this.notify();
  }
}
