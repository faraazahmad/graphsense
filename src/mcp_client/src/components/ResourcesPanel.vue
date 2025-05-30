<template>
  <div class="card">
    <h2>Available Resources</h2>
    
    <div v-if="!mcpStore.hasResources && mcpStore.isConnected">
      No resources available
    </div>
    
    <div v-else-if="!mcpStore.isConnected">
      Connect to MCP server to see available resources
    </div>

    <div v-else class="resources-list">
      <div 
        v-for="resource in mcpStore.resources" 
        :key="resource.uri"
        class="resource-item"
      >
        <div class="resource-header">
          <h3>{{ resource.name || resource.uri }}</h3>
          <span v-if="resource.mimeType" class="mime-type">{{ resource.mimeType }}</span>
        </div>
        
        <p v-if="resource.description">{{ resource.description }}</p>
        <p class="resource-uri">{{ resource.uri }}</p>
        
        <button 
          @click="loadResource(resource.uri)" 
          class="button"
        >
          Load Resource
        </button>
      </div>
    </div>

    <!-- Resource Content Modal -->
    <div v-if="selectedResource" class="modal-overlay" @click="closeModal">
      <div class="modal" @click.stop>
        <h3>{{ selectedResource.uri }}</h3>
        
        <div v-if="resourceContent" class="resource-content">
          <pre>{{ resourceContent }}</pre>
        </div>

        <div v-if="resourceError" class="error">
          {{ resourceError }}
        </div>

        <button @click="closeModal" class="button">
          Close
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useMcpStore } from '../stores/mcp'
import { readResource } from '../services/mcpClient'

const mcpStore = useMcpStore()

const selectedResource = ref<{ uri: string } | null>(null)
const resourceContent = ref<string | null>(null)
const resourceError = ref<string | null>(null)

async function loadResource(uri: string) {
  selectedResource.value = { uri }
  resourceContent.value = null
  resourceError.value = null
  
  try {
    const isDevelopmentMode = localStorage.getItem('mcpDevelopmentMode') === 'true'
    
    const content = isDevelopmentMode 
      ? await readResourceMock(uri)
      : await readResource(uri)
    resourceContent.value = JSON.stringify(content, null, 2)
  } catch (error) {
    resourceError.value = error instanceof Error ? error.message : 'Unknown error'
  }
}

function closeModal() {
  selectedResource.value = null
  resourceContent.value = null
  resourceError.value = null
}
</script>

<style scoped>
.resources-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.resource-item {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 15px;
  background: #f9f9f9;
}

.resource-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.resource-header h3 {
  margin: 0;
  color: #333;
}

.mime-type {
  background: #e9ecef;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: #6c757d;
}

.resource-uri {
  font-family: monospace;
  font-size: 12px;
  color: #6c757d;
  margin: 10px 0;
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
  max-width: 800px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}

.resource-content {
  margin: 15px 0;
  padding: 10px;
  background: #f8f9fa;
  border-radius: 4px;
  max-height: 400px;
  overflow-y: auto;
}

.resource-content pre {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
}
</style>
