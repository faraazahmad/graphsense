export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
}

export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  tools?: ToolCall[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
  result?: any;
}

export interface McpSettings {
  serverCommand: string;
  serverArgs: string[];
  anthropicApiKey: string;
  environmentVariables?: Record<string, string>;
}

export interface McpServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
}
