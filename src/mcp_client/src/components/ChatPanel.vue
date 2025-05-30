<template>
  <div class="card chat-panel">
    <div class="chat-header">
      <h2>Claude Chat with MCP Tools</h2>
      <button @click="clearChat" class="button" style="background: #dc3545;">
        Clear Chat
      </button>
    </div>

    <div class="chat-messages" ref="messagesContainer">
      <div v-if="chatStore.messages.length === 0" class="empty-state">
        Start a conversation with Claude. Your MCP tools will be available automatically.
      </div>
      
      <div 
        v-for="message in chatStore.messages" 
        :key="message.id"
        :class="['message', message.role]"
      >
        <div class="message-header">
          <span class="role">{{ message.role === 'user' ? 'You' : 'Claude' }}</span>
          <span class="timestamp">{{ formatTime(message.timestamp) }}</span>
        </div>
        
        <div class="message-content">
          <pre v-if="message.role === 'assistant'">{{ message.content }}</pre>
          <p v-else>{{ message.content }}</p>
        </div>

        <div v-if="message.tools && message.tools.length > 0" class="tool-calls">
          <h4>Tool Calls:</h4>
          <div 
            v-for="(tool, index) in message.tools" 
            :key="index"
            class="tool-call"
          >
            <strong>{{ tool.name }}</strong>
            <pre>{{ JSON.stringify(tool.arguments, null, 2) }}</pre>
            <div v-if="tool.result" class="tool-result">
              <strong>Result:</strong>
              <pre>{{ JSON.stringify(tool.result, null, 2) }}</pre>
            </div>
          </div>
        </div>
      </div>

      <div v-if="chatStore.isLoading" class="message assistant loading">
        <div class="message-header">
          <span class="role">Claude</span>
        </div>
        <div class="message-content">
          <div class="loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>
    </div>

    <div class="chat-input">
      <div v-if="chatStore.error" class="error">
        {{ chatStore.error }}
      </div>
      
      <div class="input-group">
        <textarea 
          v-model="newMessage"
          @keydown="handleKeyDown"
          class="textarea"
          placeholder="Type your message... (Shift+Enter for new line, Enter to send)"
          rows="3"
        ></textarea>
        
        <button 
          @click="sendMessage"
          class="button send-button"
        >
          Send
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { useChatStore } from '../stores/chat'
import { useMcpStore } from '../stores/mcp'
import { sendChatMessage } from '../services/chatService'

const chatStore = useChatStore()
const mcpStore = useMcpStore()

const newMessage = ref('')
const messagesContainer = ref<HTMLElement>()

const canSendMessage = computed(() => 
  newMessage.value.trim() !== '' && 
  !chatStore.isLoading &&
  mcpStore.settings.anthropicApiKey.trim() !== ''
)

function formatTime(date: Date): string {
  return date.toLocaleTimeString()
}

async function sendMessage() {
  if (!canSendMessage.value) return

  const content = newMessage.value.trim()
  newMessage.value = ''

  // Add user message
  chatStore.addMessage({
    role: 'user',
    content
  })

  // Scroll to bottom
  await nextTick()
  scrollToBottom()

  // Send to Claude
  await sendChatMessage(content)
  
  // Scroll to bottom again after response
  await nextTick()
  scrollToBottom()
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}

function clearChat() {
  chatStore.clearMessages()
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

onMounted(() => {
  scrollToBottom()
})
</script>

<style scoped>
.chat-panel {
  height: 70vh;
  display: flex;
  flex-direction: column;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 0;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fafafa;
}

.empty-state {
  text-align: center;
  color: #6c757d;
  padding: 40px 20px;
  font-style: italic;
}

.message {
  margin: 10px;
  padding: 15px;
  border-radius: 8px;
  max-width: 80%;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.message.user {
  background: #007bff;
  color: white;
  margin-left: auto;
  margin-right: 10px;
}

.message.assistant {
  background: white;
  border: 1px solid #ddd;
  margin-right: auto;
  margin-left: 10px;
}

.message.loading {
  background: #f8f9fa;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  opacity: 0.8;
}

.role {
  font-weight: 600;
}

.timestamp {
  font-size: 11px;
}

.message-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  font-family: inherit;
  max-width: 100%;
}

.message-content p {
  margin: 0;
}

.tool-calls {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #eee;
}

.tool-calls h4 {
  margin: 0 0 10px 0;
  color: #6c757d;
  font-size: 14px;
}

.tool-call {
  background: #f8f9fa;
  padding: 10px;
  border-radius: 4px;
  margin-bottom: 10px;
}

.tool-call strong {
  display: block;
  margin-bottom: 5px;
  color: #007bff;
}

.tool-call pre {
  margin: 5px 0;
  font-size: 12px;
  background: #e9ecef;
  padding: 8px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.tool-result {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #dee2e6;
}

.loading-dots {
  display: flex;
  gap: 4px;
  align-items: center;
}

.loading-dots span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #007bff;
  animation: loading 1.4s infinite ease-in-out;
}

.loading-dots span:nth-child(1) { animation-delay: -0.32s; }
.loading-dots span:nth-child(2) { animation-delay: -0.16s; }

@keyframes loading {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}

.chat-input {
  margin-top: 20px;
}

.input-group {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.input-group .textarea {
  flex: 1;
  resize: none;
}

.send-button {
  padding: 10px 20px;
  height: fit-content;
}
</style>
