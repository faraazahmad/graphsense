<template>
  <div class="card">
    <h2>Available Tools</h2>
    
    <div v-if="!mcpStore.hasTools && mcpStore.isConnected">
      No tools available
    </div>
    
    <div v-else-if="!mcpStore.isConnected">
      Connect to MCP server to see available tools
    </div>

    <div v-else class="tools-grid">
      <div 
        v-for="tool in mcpStore.tools" 
        :key="tool.name"
        class="tool-card"
      >
        <h3>{{ tool.name }}</h3>
        <p v-if="tool.description">{{ tool.description }}</p>
        
        <details>
          <summary>Schema</summary>
          <pre>{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre>
        </details>
        
        <button 
          @click="testTool(tool)" 
          class="button"
          style="margin-top: 10px;"
        >
          Test Tool
        </button>
      </div>
    </div>

    <!-- Tool Test Modal -->
    <div v-if="selectedTool" class="modal-overlay" @click="closeModal">
      <div class="modal" @click.stop>
        <h3>Test {{ selectedTool.name }}</h3>
        <p v-if="selectedTool.description">{{ selectedTool.description }}</p>
        
        <div class="form-group">
          <label>Arguments (JSON):</label>
          <textarea 
            v-model="toolArgs" 
            class="textarea"
            placeholder='{"arg1": "value1", "arg2": "value2"}'
          ></textarea>
        </div>

        <div class="form-group">
          <button @click="executeTool" class="button" :disabled="isExecuting">
            {{ isExecuting ? 'Executing...' : 'Execute' }}
          </button>
          <button @click="closeModal" class="button" style="margin-left: 10px; background: #6c757d;">
            Cancel
          </button>
        </div>

        <div v-if="toolResult" class="tool-result">
          <h4>Result:</h4>
          <pre>{{ JSON.stringify(toolResult, null, 2) }}</pre>
        </div>

        <div v-if="toolError" class="error">
          {{ toolError }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useMcpStore } from '../stores/mcp'
import { callTool } from '../services/mcpClient'
import type { McpTool } from '../types'

const mcpStore = useMcpStore()

const selectedTool = ref<McpTool | null>(null)
const toolArgs = ref('')
const toolResult = ref<any>(null)
const toolError = ref<string | null>(null)
const isExecuting = ref(false)

function testTool(tool: McpTool) {
  selectedTool.value = tool
  toolArgs.value = ''
  toolResult.value = null
  toolError.value = null
}

function closeModal() {
  selectedTool.value = null
  toolArgs.value = ''
  toolResult.value = null
  toolError.value = null
}

async function executeTool() {
  if (!selectedTool.value) return
  
  isExecuting.value = true
  toolError.value = null
  toolResult.value = null
  
  try {
    const args = toolArgs.value.trim() ? JSON.parse(toolArgs.value) : {}
    const isDevelopmentMode = localStorage.getItem('mcpDevelopmentMode') === 'true'
    
    const result = isDevelopmentMode 
      ? await callToolMock(selectedTool.value.name, args)
      : await callTool(selectedTool.value.name, args)
    toolResult.value = result
  } catch (error) {
    toolError.value = error instanceof Error ? error.message : 'Unknown error'
  } finally {
    isExecuting.value = false
  }
}
</script>

<style scoped>
.tools-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

.tool-card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 15px;
  background: #f9f9f9;
}

.tool-card h3 {
  margin-bottom: 10px;
  color: #333;
}

.tool-card details {
  margin: 10px 0;
}

.tool-card pre {
  background: #f5f5f5;
  padding: 10px;
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 8px;
  padding: 20px;
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}

.tool-result {
  margin-top: 15px;
  padding: 10px;
  background: #f8f9fa;
  border-radius: 4px;
}

.tool-result pre {
  margin: 0;
  font-size: 12px;
}
</style>
