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
      <label>Environment variables</label>
      <div class="env-vars-container">
        <div class="env-var-row" v-for="(key, index) in envVarKeys" :key="index">
          <input
            class="input-var-key"
            type="text"
            v-model="envVarKeys[index]"
            placeholder="Variable name"
            @input="updateEnvVarKey(index, $event.target.value)"
          >
          <input
            class="input-var-value"
            type="password"
            v-model="localSettings.environmentVariables[key]"
            placeholder="Variable value"
          >
          <button
            @click="removeEnvVar(index)"
            type="button"
            class="delete-button"
          >x</button>
        </div>
        <button class="button add-button" @click="addEnvVar" type="button">+ Add Env var</button>
      </div>
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
const envVarKeys = ref<string[]>([]);

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
  console.log(mcpStore.settings)
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

async function connectMcpMock() {
  // Mock connection function - implement as needed
  console.log('Mock MCP connection')
}

function updateEnvVarKeys() {
  envVarKeys.value = Object.keys(localSettings.value.environmentVariables || {})
  if (envVarKeys.value.length === 0) {
    addEnvVar()
  }
}

function addEnvVar() {
  envVarKeys.value.push('')
}

function removeEnvVar(index: number) {
  const keyToRemove = envVarKeys.value[index]
  envVarKeys.value.splice(index, 1)
  if (keyToRemove && localSettings.value.environmentVariables) {
    delete localSettings.value.environmentVariables[keyToRemove]
  }
}

function updateEnvVarKey(index: number, newKey: string) {
  const oldKey = envVarKeys.value[index]
  if (oldKey && oldKey !== newKey && localSettings.value.environmentVariables) {
    const value = localSettings.value.environmentVariables[oldKey]
    delete localSettings.value.environmentVariables[oldKey]
    if (newKey.trim()) {
      localSettings.value.environmentVariables[newKey] = value || ''
    }
  } else if (newKey.trim() && localSettings.value.environmentVariables) {
    localSettings.value.environmentVariables[newKey] = localSettings.value.environmentVariables[newKey] || ''
  }
  envVarKeys.value[index] = newKey
}

onMounted(() => {
  mcpStore.loadSettings()
  localSettings.value = { 
    ...mcpStore.settings,
    environmentVariables: mcpStore.settings.environmentVariables || {}
  }
  serverArgsString.value = mcpStore.settings.serverArgs.join(', ')
  updateEnvVarKeys()
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
