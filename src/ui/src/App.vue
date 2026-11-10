<script setup>
import { computed, onMounted, ref } from 'vue'
import IntroOverlay from './components/IntroOverlay.vue'
import RailNav from './components/RailNav.vue'
import ChatPane from './components/ChatPane.vue'
import EventCurationPane from './components/EventCurationPane.vue'
import RunBench from './components/RunBench.vue'
import ToastMessage from './components/ToastMessage.vue'
import WorkspaceDialog from './components/WorkspaceDialog.vue'
import HistoryDialog from './components/HistoryDialog.vue'
import ConnectionSettingsDialog from './components/ConnectionSettingsDialog.vue'
import { useAgentRun } from './composables/useAgentRun'
import { useTheme } from './composables/useTheme'
import { useToast } from './composables/useToast'

const collapsed = ref(true)
const introReveal = ref(false)
const activeView = ref('chat')
const workspaceDialogOpen = ref(false)
const historyDialogOpen = ref(false)
const connectionDialogOpen = ref(false)
const chat = useAgentRun('chat')
const curation = useAgentRun('curation')
const currentRun = computed(() => activeView.value === 'curation' ? curation : chat)
const activeNav = computed(() => {
  if (historyDialogOpen.value) return 'history'
  if (connectionDialogOpen.value) return 'connection-settings'
  return activeView.value
})
const anyRunning = computed(() => chat.running || curation.running)
const anySessionBusy = computed(() => anyRunning.value || chat.newChatBusy || curation.newChatBusy)
const { toggleTheme } = useTheme()
const { text: toastText, show: showToast } = useToast()

onMounted(async () => {
  try {
    await Promise.all([chat.initialize(), curation.initialize()])
  } catch (error) {
    showToast(`连接 Agent 失败：${error.message}`)
  }
})

function syncSharedState(source) {
  for (const target of [chat, curation]) {
    target.mode = source.mode
    target.model = source.model
    target.workspace = source.workspace
  }
}

function showView(view) {
  activeView.value = view
}

async function handleMode(next) {
  try {
    const run = currentRun.value
    await run.setMode(next)
    syncSharedState(run)
  } catch (error) {
    showToast(error.message)
  }
}

async function handleNewChat() {
  const view = activeView.value
  try {
    const run = currentRun.value
    if (await run.newChat()) {
      syncSharedState(run)
      showToast(view === 'curation' ? '已归档原策展对话，可以开始新的活动策划' : '记忆已保存，当前对话已归档')
    }
  } catch (error) {
    showToast(`新建对话失败，当前对话未归档：${error.message}`)
  }
}

function handleSend(text) {
  void currentRun.value.run(text)
}

async function handleWorkspace(path) {
  if (anySessionBusy.value) return
  try {
    await currentRun.value.changeWorkspace(path)
    syncSharedState(currentRun.value)
    workspaceDialogOpen.value = false
    showToast('工作区已切换')
  } catch (error) {
    showToast(`切换工作区失败：${error.message}`)
  }
}

async function handleConnectionSaved(result) {
  try {
    await Promise.all([chat.initialize(result.state), curation.initialize(result.state)])
    showToast('连接配置已保存；保存不代表连通性已验证')
  } catch (error) {
    showToast(`连接已保存，但状态刷新失败：${error.message}`)
  }
}

async function handleStop() {
  try {
    await currentRun.value.stop()
  } catch (error) {
    showToast(`中止失败：${error.message}`)
  }
}
</script>

<template>
  <div class="app" :class="{ collapsed, 'intro-reveal': introReveal }">
    <IntroOverlay @complete="played => introReveal = played" />
    <RailNav
      :active-nav="activeNav"
      :running="currentRun.running"
      :new-chat-busy="currentRun.newChatBusy"
      :chat-running="chat.running"
      :curation-running="curation.running"
      @chat="showView('chat')"
      @event-curation="showView('curation')"
      @new-chat="handleNewChat"
      @history="historyDialogOpen = true"
      @connection-settings="connectionDialogOpen = true"
      @toggle-theme="toggleTheme" />

    <ChatPane
      v-show="activeView === 'chat'"
      :msgs="chat.msgs"
      :running="chat.running"
      :new-chat-busy="chat.newChatBusy"
      :collapsed="collapsed"
      :effort="chat.effort"
      :model-name="chat.model"
      :mode="chat.mode"
      :mode-busy="chat.modeBusy"
      :workspace="chat.workspace"
      :settings-busy="anySessionBusy"
      @update:mode="handleMode"
      @update:effort="value => chat.effort = value"
      @send="handleSend"
      @stop="handleStop"
      @decide="chat.decide"
      @toggle-bench="collapsed = !collapsed"
      @change-workspace="workspaceDialogOpen = true" />

    <EventCurationPane
      v-show="activeView === 'curation'"
      :msgs="curation.msgs"
      :running="curation.running"
      :status="curation.status"
      :new-chat-busy="curation.newChatBusy"
      :collapsed="collapsed"
      :effort="curation.effort"
      :model-name="curation.model"
      :mode="curation.mode"
      :mode-busy="curation.modeBusy"
      :workspace="curation.workspace"
      :settings-busy="anySessionBusy"
      @update:mode="handleMode"
      @update:effort="value => curation.effort = value"
      @send="handleSend"
      @stop="handleStop"
      @decide="curation.decide"
      @toggle-bench="collapsed = !collapsed"
      @change-workspace="workspaceDialogOpen = true" />

    <RunBench
      :steps="currentRun.steps"
      :status="currentRun.status"
      :tokens="currentRun.tokens"
      :mode="activeView" />
    <WorkspaceDialog
      :open="workspaceDialogOpen"
      :current="currentRun.workspace"
      @close="workspaceDialogOpen = false"
      @select="handleWorkspace" />
    <HistoryDialog
      :open="historyDialogOpen"
      :mode="activeView"
      @close="historyDialogOpen = false" />
    <ConnectionSettingsDialog
      :open="connectionDialogOpen"
      :running="anySessionBusy"
      @close="connectionDialogOpen = false"
      @saved="handleConnectionSaved" />
    <ToastMessage :text="toastText" />
  </div>
</template>
