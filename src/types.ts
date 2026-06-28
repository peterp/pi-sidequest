export type SessionContextItem = {
  id: string;
  label: string;
  text: string;
};

export type SidequestNodeStatus = "loading" | "done" | "error";
export type SidequestMode = "select" | "prompt";

export type SidequestGrounding = {
  contextInfo: string;
  activeSessionContext: string;
  sidequestParentPath: string;
  model: string;
  tools: string;
  timestamp: string;
};

export type SidequestNode = {
  id: string;
  parentId: string | null;
  question: string;
  answer?: string;
  error?: string;
  status: SidequestNodeStatus;
  read?: boolean;
  grounding?: SidequestGrounding;
};

export type SidequestResult = { action: "close" };

export type AskInSidequest = (
  question: string,
  priorPath: SidequestNode[],
  signal: AbortSignal,
  onUpdate: (partialAnswer: string) => void,
) => Promise<string>;

export type RenderListener = () => void;
export type StatusUpdater = (text: string | undefined) => void;

export type PersistedSidequestState = {
  version: 1;
  nodes: SidequestNode[];
  selectedNodeId: string | null;
  draft: string;
  showRead?: boolean;
};
