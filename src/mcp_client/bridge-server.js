#!/usr/bin/env node

/**
 * MCP Bridge Server
 * 
 * This creates an HTTP bridge to your MCP server, allowing the browser client
 * to communicate with the MCP server via HTTP instead of stdio.
 */

import { spawn } from 'child_process'
import express from 'express'
import cors from 'cors'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const app = express()
const PORT = 3002

app.use(cors())
app.use(express.json())

let mcpClient = null
let mcpTransport = null

// Connect to MCP server
async function connectToMcp(command, args, env = {}) {
  if (mcpClient) {
    await disconnectFromMcp()
  }

  try {
    mcpTransport = new StdioClientTransport({
      command,
      args,
      env: { ...process.env, ...env }
    })

    mcpClient = new Client({
      name: 'mcp-bridge-client',
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {},
        resources: {}
      }
    })

    await mcpClient.connect(mcpTransport)
    console.log('✅ Connected to MCP server')
    return true
  } catch (error) {
    console.error('❌ Failed to connect to MCP server:', error.message)
    throw error
  }
}

async function disconnectFromMcp() {
  if (mcpClient) {
    try {
      await mcpClient.close()
    } catch (error) {
      console.error('Error closing MCP client:', error)
    }
    mcpClient = null
  }

  if (mcpTransport) {
    try {
      await mcpTransport.close()
    } catch (error) {
      console.error('Error closing MCP transport:', error)
    }
    mcpTransport = null
  }
}

// API Routes

// Connect to MCP server
app.post('/api/mcp/connect', async (req, res) => {
  try {
    const { command, args, environmentVariables } = req.body
    await connectToMcp(command, args, environmentVariables)
    
    // Get server info
    const serverInfo = {
      name: 'Code Graph RAG',
      version: '1.0.0', 
      protocolVersion: '2024-11-05'
    }

    // List tools
    const toolsResult = await mcpClient.listTools()
    
    // List resources
    const resourcesResult = await mcpClient.listResources()

    res.json({
      success: true,
      serverInfo,
      tools: toolsResult.tools,
      resources: resourcesResult.resources
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// Disconnect from MCP server
app.post('/api/mcp/disconnect', async (req, res) => {
  try {
    await disconnectFromMcp()
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// Call MCP tool
app.post('/api/mcp/tools/call', async (req, res) => {
  try {
    if (!mcpClient) {
      throw new Error('Not connected to MCP server')
    }

    const { name, arguments: args } = req.body
    const result = await mcpClient.callTool({ name, arguments: args })
    
    res.json({
      success: true,
      result
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// Read MCP resource
app.post('/api/mcp/resources/read', async (req, res) => {
  try {
    if (!mcpClient) {
      throw new Error('Not connected to MCP server')
    }

    const { uri } = req.body
    const result = await mcpClient.readResource({ uri })
    
    res.json({
      success: true,
      result
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    connected: !!mcpClient
  })
})

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down bridge server...')
  await disconnectFromMcp()
  process.exit(0)
})

app.listen(PORT, () => {
  console.log(`🌉 MCP Bridge Server running on http://localhost:${PORT}`)
  console.log('📡 Ready to proxy requests to your MCP server')
  console.log('🔗 Browser client can now connect via HTTP')
})
