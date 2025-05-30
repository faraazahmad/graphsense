import { useMcpStore } from '../stores/mcp'
import type { McpTool, McpResource } from '../types'

// For browser compatibility, we'll use a simple HTTP-based approach
// instead of the stdio transport which doesn't work in browsers
let isConnected = false

export async function connectMcp(): Promise<void> {
  const mcpStore = useMcpStore()
  
  mcpStore.setConnecting(true)
  mcpStore.setError(null)

  try {
    // Connect via bridge server
    const response = await fetch('http://localhost:3002/api/mcp/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: mcpStore.settings.serverCommand,
        args: mcpStore.settings.serverArgs,
        environmentVariables: mcpStore.settings.environmentVariables || {}
      })
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    
    if (!data.success) {
      throw new Error(data.error || 'Connection failed')
    }

    // Set server info
    mcpStore.setServerInfo(data.serverInfo)

    // Set tools
    const tools: McpTool[] = data.tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
    mcpStore.setTools(tools)

    // Set resources  
    const resources: McpResource[] = data.resources.map((resource: any) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType
    }))
    mcpStore.setResources(resources)

    isConnected = true
    mcpStore.setConnected(true)
    
  } catch (error) {
    let errorMessage = 'Connection failed'
    
    if (error instanceof Error) {
      if (error.message.includes('fetch')) {
        errorMessage = 'Bridge server not running. Please start: node bridge-server.js'
      } else {
        errorMessage = error.message
      }
    }
    
    mcpStore.setError(errorMessage)
    throw error
  } finally {
    mcpStore.setConnecting(false)
  }
}

export async function disconnectMcp(): Promise<void> {
  const mcpStore = useMcpStore()
  
  if (isConnected) {
    try {
      await fetch('http://localhost:3002/api/mcp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('Error disconnecting from bridge server:', error)
    }
  }
  
  isConnected = false
  mcpStore.setConnected(false)
}

export async function callTool(name: string, args: Record<string, any>): Promise<any> {
  if (!isConnected) {
    throw new Error('Not connected to MCP server')
  }

  try {
    const response = await fetch('http://localhost:3002/api/mcp/tools/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: args })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `HTTP ${response.status}`)
    }

    const data = await response.json()
    
    if (!data.success) {
      throw new Error(data.error || 'Tool call failed')
    }

    return data.result
  } catch (error) {
    throw new Error(`Tool call failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export async function readResource(uri: string): Promise<any> {
  if (!isConnected) {
    throw new Error('Not connected to MCP server')
  }

  try {
    const response = await fetch('http://localhost:3002/api/mcp/resources/read', {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `HTTP ${response.status}`)
    }

    const data = await response.json()
    
    if (!data.success) {
      throw new Error(data.error || 'Resource read failed')
    }

    return data.result
  } catch (error) {
    throw new Error(`Resource read failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// For development/testing when we can't actually spawn the process
export async function connectMcpMock(): Promise<void> {
  const mcpStore = useMcpStore()
  
  mcpStore.setConnecting(true)
  mcpStore.setError(null)

  try {
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Mock server info
    const serverInfo = {
      name: 'Code Graph RAG',
      version: '1.0.0',
      protocolVersion: '2024-11-05'
    }
    mcpStore.setServerInfo(serverInfo)

    // Mock tools based on the actual MCP server
    const tools: McpTool[] = [
      {
        name: 'similar_functions',
        description: 'To search for functions in the codebase based on what they do.',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'Description of what the function does'
            },
            topK: {
              type: 'number',
              description: 'Number of results to return (default: 10)'
            }
          },
          required: ['description']
        }
      },
      {
        name: 'function_callers',
        description: 'Find functions that call a specific function',
        inputSchema: {
          type: 'object',
          properties: {
            functionId: {
              type: 'string',
              description: 'The element ID of the function to find callers for'
            }
          },
          required: ['functionId']
        }
      },
      {
        name: 'function_callees',
        description: 'Find functions called by a specific function',
        inputSchema: {
          type: 'object',
          properties: {
            functionId: {
              type: 'string',
              description: 'The element ID of the function to find callees for'
            }
          },
          required: ['functionId']
        }
      },
      {
        name: 'function_details',
        description: 'Get detailed information about a function',
        inputSchema: {
          type: 'object',
          properties: {
            functionId: {
              type: 'string',
              description: 'The element ID of the function to get details for'
            }
          },
          required: ['functionId']
        }
      }
    ]
    mcpStore.setTools(tools)

    // Mock resources
    const resources: McpResource[] = [
      {
        uri: 'greeting://world',
        name: 'Greeting Resource',
        description: 'A dynamic greeting resource'
      }
    ]
    mcpStore.setResources(resources)

    mcpStore.setConnected(true)
  } catch (error) {
    mcpStore.setError(error instanceof Error ? error.message : 'Connection failed')
    throw error
  } finally {
    mcpStore.setConnecting(false)
  }
}

// Mock tool calls for development
export async function callToolMock(name: string, args: Record<string, any>): Promise<any> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500))

  switch (name) {
    case 'similar_functions':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                id: 'func1',
                name: 'calculateDistance',
                similarity: 0.85,
                summary: 'Calculates distance between two points'
              },
              {
                id: 'func2', 
                name: 'findNearbyPoints',
                similarity: 0.78,
                summary: 'Finds points within a given radius'
              }
            ], null, 2)
          }
        ]
      }
    
    case 'function_callers':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { id: 'caller1', name: 'processData' },
              { id: 'caller2', name: 'validateInput' }
            ], null, 2)
          }
        ]
      }
    
    case 'function_callees':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { id: 'callee1', name: 'helper1' },
              { id: 'callee2', name: 'helper2' }
            ], null, 2)
          }
        ]
      }
    
    case 'function_details':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: args.functionId,
              name: 'exampleFunction',
              code: 'function exampleFunction() { return "Hello"; }',
              summary: 'An example function that returns a greeting'
            }, null, 2)
          }
        ]
      }
    
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

export async function readResourceMock(uri: string): Promise<any> {
  await new Promise(resolve => setTimeout(resolve, 300))
  
  if (uri.startsWith('greeting://')) {
    const name = uri.split('//')[1] || 'world'
    return {
      contents: [
        {
          uri,
          text: `Hello, ${name}!`
        }
      ]
    }
  }
  
  throw new Error(`Unknown resource: ${uri}`)
}
