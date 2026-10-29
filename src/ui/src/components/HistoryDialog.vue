<script setup>
import { ref, watch } from 'vue'
import { getHistory, getHistoryMessages } from '../api'
import MessageItem from './MessageItem.vue'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const conversations = ref([])
const nextBefore = ref(null)
const listLoading = ref(false)
const listError = ref('')
const selected = ref(null)
const messages = ref([])
const messagesOffset = ref(0)
const messagesHasMore = ref(false)
const messagesLoading = ref(false)
const messagesError = ref('')
let listRequestId = 0
let messagesRequestId = 0

watch(() => props.open, (open) => {
  if (open) {
    resetHistory()
    void loadConversations(false)
  } else {
    listRequestId += 1
    messagesRequestId += 1
  }
}, { immediate: true })

function resetHistory() {
  conversations.value = []
  nextBefore.value = null
  listLoading.value = false
  listError.value = ''
  selected.value = null
  messages.value = []
  messagesOffset.value = 0
  messagesHasMore.value = false
  messagesLoading.value = false
  messagesError.value = ''
}

async function loadConversations(append) {
  if (listLoading.value) return
  const id = ++listRequestId
  const cursor = append ? nextBefore.value : null
  listLoading.value = true
  listError.value = ''
  try {
    const data = await getHistory(cursor)
    if (id !== listRequestId) return
    conversations.value = append
      ? [...conversations.value, ...data.conversations]
      : data.conversations
    nextBefore.value = data.next_before
    if (!append && conversations.value.length) selectConversation(conversations.value[0])
  } catch (error) {
    if (id === listRequestId) listError.value = error.message
  } finally {
    if (id === listRequestId) listLoading.value = false
  }
}

function selectConversation(conversation) {
  messagesRequestId += 1
  selected.value = conversation
  messages.value = []
  messagesOffset.value = 0
  messagesHasMore.value = false
  messagesLoading.value = false
  messagesError.value = ''
  void loadMessages(false)
}

async function loadMessages(append) {
  const conversation = selected.value
  if (!conversation || messagesLoading.value) return
  const id = ++messagesRequestId
  const offset = append ? messagesOffset.value : 0
  messagesLoading.value = true
  messagesError.value = ''
  try {
    const data = await getHistoryMessages(conversation.id, offset)
    if (id !== messagesRequestId || selected.value?.id !== conversation.id) return
    const page = data.messages.map((message, index) => ({
      id: `${conversation.id}-${offset + index}`,
      kind: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'agent' : 'chip',
      text: message.text
    }))
    messages.value = append ? [...messages.value, ...page] : page
    messagesOffset.value = offset + data.messages.length
    messagesHasMore.value = data.has_more
  } catch (error) {
    if (id === messagesRequestId) messagesError.value = error.message
  } finally {
    if (id === messagesRequestId) messagesLoading.value = false
  }
}

function isLastOfGroup(index) {
  const current = messages.value[index]
  const next = messages.value[index + 1]
  return current && (current.kind === 'user' || current.kind === 'agent') && (!next || next.kind !== current.kind)
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
      <section class="workspace-dialog history-dialog" role="dialog" aria-modal="true" aria-label="只读历史对话">
        <header class="dialog-head">
          <h2>历史对话</h2>
          <span class="history-readonly">只读</span>
          <button title="关闭" @click="emit('close')">×</button>
        </header>

        <div class="history-body">
          <aside class="history-list" aria-label="已归档会话">
            <div v-if="listError" class="history-error">
              <span>{{ listError }}</span>
              <button @click="loadConversations(false)">重试</button>
            </div>
            <div v-if="listLoading && !conversations.length" class="empty">正在读取历史对话</div>
            <div v-else-if="!conversations.length && !listError" class="empty">还没有已归档的对话</div>
            <button
              v-for="conversation in conversations"
              :key="conversation.id"
              class="history-conversation"
              :class="{ selected: selected?.id === conversation.id }"
              @click="selectConversation(conversation)">
              <strong>{{ conversation.title || '未命名对话' }}</strong>
              <time>{{ formatTime(conversation.last_message_at) }}</time>
              <p>{{ conversation.desc || '此归档没有摘要' }}</p>
            </button>
            <button
              v-if="nextBefore"
              class="history-more"
              :disabled="listLoading"
              @click="loadConversations(true)">
              {{ listLoading ? '正在加载' : '加载更多归档' }}
            </button>
          </aside>

          <section class="history-detail">
            <template v-if="selected">
              <header class="history-detail-head">
                <h3>{{ selected.title || '未命名对话' }}</h3>
                <p>{{ selected.desc || '此归档没有摘要' }}</p>
              </header>
              <div class="history-messages">
                <div v-if="messagesError" class="history-error">
                  <span>{{ messagesError }}</span>
                  <button @click="loadMessages(false)">重试</button>
                </div>
                <div v-if="messagesLoading && !messages.length" class="empty">正在读取消息</div>
                <MessageItem
                  v-for="(message, index) in messages"
                  :key="message.id"
                  :msg="message"
                  :is-last="isLastOfGroup(index)" />
                <div v-if="!messagesLoading && !messagesError && !messages.length" class="empty">此归档没有消息</div>
                <button
                  v-if="messagesHasMore"
                  class="history-more"
                  :disabled="messagesLoading"
                  @click="loadMessages(true)">
                  {{ messagesLoading ? '正在加载' : '加载后续消息' }}
                </button>
              </div>
            </template>
            <div v-else class="empty">选择一个归档查看只读消息</div>
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>
