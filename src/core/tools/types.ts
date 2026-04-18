export interface Tool {
  id: number;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
}

export interface ToolGrant {
  scope: string;
  canRead: boolean;
  canWrite: boolean;
}

export interface ToolWithGrants extends Tool {
  grants: ToolGrant[];
}

export interface NewToolInput {
  name: string;
  scopes: string[];
  readOnly?: boolean;
}

export interface ProvisionedTool {
  tool: Tool;
  /** Plaintext token — shown once, never stored. */
  token: string;
  grants: ToolGrant[];
}
