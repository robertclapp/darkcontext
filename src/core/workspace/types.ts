export interface Workspace {
  id: number;
  name: string;
  isActive: boolean;
  scope: string | null;
  createdAt: number;
}

export interface WorkspaceItem {
  id: number;
  workspaceId: number;
  kind: string;
  content: string;
  state: string;
  updatedAt: number;
}

export interface NewWorkspace {
  name: string;
  scope?: string;
}

export interface NewWorkspaceItem {
  kind: string;
  content: string;
  state?: string;
}
