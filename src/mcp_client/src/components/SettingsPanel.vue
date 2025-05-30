<template>
  <div class="card">
    <h2>MCP Server Settings</h2>
    
    <div class="form-group">
      <label>Server Command:</label>
      <input 
        v-model="localSettings.serverCommand" 
        class="input" 
        placeholder="node"
      />
    </div>

    <div class="form-group">
      <label>Server Arguments (comma-separated):</label>
      <input 
        v-model="serverArgsString" 
        class="input" 
        placeholder="../../build/mcp.js"
      />
    </div>

    <div class="form-group">
      <label>Anthropic API Key:</label>
      <input 
        v-model="localSettings.anthropicApiKey" 
        type="password" 
        class="input" 
        placeholder="sk-ant-..."
      />
    </div>

    <div class="form-group">
      <button 
        @click="saveSettings" 
        class="button"
        :disabled="!isValid"
      >
        Save Settings
      </button>
      
      <button 
        @click="connectToServer" 
        class="button"
        :disabled="!canConnect"
        style="margin-left: 10px;"
      >
        {{ mcpStore.isConnected ? 'Disconnect' : 'Connect to MCP Server' }}
      </button>
    </div>

    <div v-if="mcpStore.error" class="error">
      {{ mcpStore.error }}
    </div>

    <div v-if="mcpStore.isConnecting" class="success">
      Connecting to MCP server...
    </div>

    <div v-if="mcpStore.serverInfo" class="success">
      Connected to {{ mcpStore.serverInfo.name }} v{{ mcpStore.serverInfo.version }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useMcpStore } from '../stores/mcp'
import { connectMcp, disconnectMcp } from '../services/mcpClient'

const mcpStore = useMcpStore()

const localSettings = ref({ ...mcpStore.settings })
const serverArgsString = ref(mcpStore.settings.serverArgs.join(', '))

const isValid = computed(() => 
  localSettings.value.serverCommand.trim() !== '' &&
  localSettings.value.anthropicApiKey.trim() !== ''
)

const canConnect = computed(() => 
  isValid.value && !mcpStore.isConnecting
)

// Watch for changes in server args string
watch(serverArgsString, (newValue) => {
  localSettings.value.serverArgs = newValue
    .split(',')
    .map(arg => arg.trim())
    .filter(arg => arg !== '')
})

function saveSettings() {
  mcpStore.setSettings(localSettings.value)
}

async function connectToServer() {
  if (mcpStore.isConnected) {
    await disconnectMcp()
  } else {
    // Check if we're in development mode
    const isDevelopmentMode = localStorage.getItem('mcpDevelopmentMode') === 'true'
    
    if (isDevelopmentMode) {
      await connectMcpMock()
    } else {
      await connectMcp()
    }
  }
}

onMounted(() => {
  mcpStore.loadSettings()
  localSettings.value = { ...mcpStore.settings }
  serverArgsString.value = mcpStore.settings.serverArgs.join(', ')
})
</script>

<style scoped>
.env-vars-container {
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 15px;
  background: #f9f9f9;
}

.env-var-row {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
  align-items: center;
}

.env-var-key {
  flex: 1;
  min-width: 150px;
}

.env-var-value {
  flex: 2;
  min-width: 200px;
}

.delete-button {
  background: #dc3545;
  color: white;
  border: none;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
}

.delete-button:hover {
  background: #c82333;
}

.add-button {
  background: #28a745;
  margin-top: 10px;
}

.add-button:hover {
  background: #218838;
}

@media (max-width: 768px) {
  .env-var-row {
    flex-direction: column;
    align-items: stretch;
  }
  
  .env-var-key,
  .env-var-value {
    min-width: auto;
  }
}
</style>
