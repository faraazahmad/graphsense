<template>
  <div class="container">
    <header>
      <h1>MCP Debug Client</h1>
      <p>Debug and test your Model Context Protocol server</p>
    </header>

    <div class="grid grid-2">
      <!-- Left Column: Settings and Tools -->
      <div>
        <SettingsPanel />
        
        <div v-if="mcpStore.isConnected" class="grid">
          <ToolsPanel />
          <ResourcesPanel />
        </div>
      </div>

      <!-- Right Column: Chat -->
      <div>
        <ChatPanel />
      </div>
    </div>

    <!-- Development Mode Toggle -->
    <div class="card" style="margin-top: 20px;">
      <h3>Development Mode</h3>
      <p>
        In development mode, the client uses mock data instead of connecting to the actual MCP server.
        This is useful for testing the UI when the server is not available.
      </p>
      <label style="display: flex; align-items: center; gap: 10px;">
        <input 
          type="checkbox" 
          v-model="isDevelopmentMode"
          @change="toggleDevelopmentMode"
        />
        Use mock data (development mode)
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useMcpStore } from './stores/mcp'
import SettingsPanel from './components/SettingsPanel.vue'
import ToolsPanel from './components/ToolsPanel.vue'
import ResourcesPanel from './components/ResourcesPanel.vue'
import ChatPanel from './components/ChatPanel.vue'

const mcpStore = useMcpStore()
const isDevelopmentMode = ref(false)

function toggleDevelopmentMode() {
  // Save preference
  localStorage.setItem('mcpDevelopmentMode', isDevelopmentMode.value.toString())
  
  if (mcpStore.isConnected) {
    // Disconnect and reconnect with new mode
    // This would trigger the appropriate connection method
    console.log('Development mode toggled to:', isDevelopmentMode.value)
  }
}

onMounted(() => {
  // Load development mode preference
  const saved = localStorage.getItem('mcpDevelopmentMode')
  if (saved) {
    isDevelopmentMode.value = saved === 'true'
  }

  // Load MCP settings
  mcpStore.loadSettings()
})
</script>

<style>
header {
  text-align: center;
  margin-bottom: 30px;
  padding: 20px 0;
  border-bottom: 2px solid #eee;
}

header h1 {
  color: #333;
  margin-bottom: 10px;
}

header p {
  color: #6c757d;
  font-size: 16px;
}
</style>
