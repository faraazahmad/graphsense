import Anthropic from '@anthropic-ai/sdk'
import { useChatStore } from '../stores/chat'
import { useMcpStore } from '../stores/mcp'
import { callTool, callToolMock } from './mcpClient'
import type { ToolCall } from '../types'

export async function sendChatMessage(content: string): Promise<void> {
  const chatStore = useChatStore()
  const mcpStore = useMcpStore()
  
  chatStore.setLoading(true)
  chatStore.setError(null)

  try {
    const anthropic = new Anthropic({
      apiKey: mcpStore.settings.anthropicApiKey,
      dangerouslyAllowBrowser: true
    })

    // Build tools array from MCP tools
    const tools = mcpStore.tools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.inputSchema
    }))

    // Build messages array
    const messages = chatStore.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }))

    // Add current message
    messages.push({
      role: 'user' as const,
      content
    })

    // Call Claude with tools
    const response = await anthropic.messages.create({
      model: 'claude-4-sonnet-20250514',
      max_tokens: 4096,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? { type: 'auto' } : undefined
    })

    let assistantContent = ''
    const toolCalls: ToolCall[] = []

    // Process response content
    for (const contentBlock of response.content) {
      if (contentBlock.type === 'text') {
        assistantContent += contentBlock.text
      } else if (contentBlock.type === 'tool_use') {
        // Execute the tool call
        try {
          const toolResult = mcpStore.isConnected 
            ? await callTool(contentBlock.name, contentBlock.input as Record<string, any>)
            : await callToolMock(contentBlock.name, contentBlock.input as Record<string, any>)

          toolCalls.push({
            name: contentBlock.name,
            arguments: contentBlock.input as Record<string, any>,
            result: toolResult
          })

          // If the tool returned content, add it to the assistant's response
          // if (toolResult && toolResult.content) {
          //   assistantContent += `\n\nTool result from ${contentBlock.name}:\n`
          //   for (const content of toolResult.content) {
          //     if (content.type === 'text') {
          //       assistantContent += content.text
          //     }
          //   }
          // }
        } catch (error) {
          toolCalls.push({
            name: contentBlock.name,
            arguments: contentBlock.input as Record<string, any>,
            result: { error: error instanceof Error ? error.message : 'Tool execution failed' }
          })
          assistantContent += `\n\nError executing ${contentBlock.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    }

    // Add assistant message
    chatStore.addMessage({
      role: 'assistant',
      content: assistantContent,
      tools: toolCalls.length > 0 ? toolCalls : undefined
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    chatStore.setError(errorMessage)
    
    // Add error message to chat
    chatStore.addMessage({
      role: 'assistant',
      content: `Error: ${errorMessage}`
    })
  } finally {
    chatStore.setLoading(false)
  }
}
