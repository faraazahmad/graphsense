import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { McpTool, McpResource, McpSettings, McpServerInfo } from '../types'

export const useMcpStore = defineStore('mcp', () => {
  // State
  const isConnected = ref(false)
  const isConnecting = ref(false)
  const serverInfo = ref<McpServerInfo | null>(null)
  const tools = ref<McpTool[]>([])
  const resources = ref<McpResource[]>([])
  const error = ref<string | null>(null)
  
  const settings = ref<McpSettings>({
    serverCommand: 'node',
    serverArgs: ['../../build/mcp.js'],
    anthropicApiKey: ''
  })

  // Getters
  const isReady = computed(() => isConnected.value && !isConnecting.value)
  const hasTools = computed(() => tools.value.length > 0)
  const hasResources = computed(() => resources.value.length > 0)

  // Actions
  function setSettings(newSettings: Partial<McpSettings>) {
    settings.value = { ...settings.value, ...newSettings }
    // Save to localStorage
    localStorage.setItem('mcpSettings', JSON.stringify(settings.value))
  }

  function loadSettings() {
    const saved = localStorage.getItem('mcpSettings')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        settings.value = { 
          ...settings.value, 
          ...parsed,
          environmentVariables: parsed.environmentVariables || {}
        }
      } catch (e) {
        console.error('Failed to load settings:', e)
      }
    }
  }

  function setConnected(connected: boolean) {
    isConnected.value = connected
    if (!connected) {
      serverInfo.value = null
      tools.value = []
      resources.value = []
    }
  }

  function setConnecting(connecting: boolean) {
    isConnecting.value = connecting
  }

  function setServerInfo(info: McpServerInfo) {
    serverInfo.value = info
  }

  function setTools(newTools: McpTool[]) {
    tools.value = newTools
  }

  function setResources(newResources: McpResource[]) {
    resources.value = newResources
  }

  function setError(errorMessage: string | null) {
    error.value = errorMessage
  }

  return {
    // State
    isConnected,
    isConnecting,
    serverInfo,
    tools,
    resources,
    error,
    settings,
    // Getters
    isReady,
    hasTools,
    hasResources,
    // Actions
    setSettings,
    loadSettings,
    setConnected,
    setConnecting,
    setServerInfo,
    setTools,
    setResources,
    setError
  }
})
