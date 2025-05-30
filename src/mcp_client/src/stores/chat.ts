import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatMessage } from '../types'

export const useChatStore = defineStore('chat', () => {
  // State
  const messages = ref<ChatMessage[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Actions
  function addMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>) {
    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      ...message
    }
    messages.value.push(newMessage)
    return newMessage
  }

  function updateMessage(id: string, updates: Partial<ChatMessage>) {
    const index = messages.value.findIndex(m => m.id === id)
    if (index !== -1) {
      messages.value[index] = { ...messages.value[index], ...updates }
    }
  }

  function clearMessages() {
    messages.value = []
  }

  function setLoading(loading: boolean) {
    isLoading.value = loading
  }

  function setError(errorMessage: string | null) {
    error.value = errorMessage
  }

  return {
    // State
    messages,
    isLoading,
    error,
    // Actions
    addMessage,
    updateMessage,
    clearMessages,
    setLoading,
    setError
  }
})
