<script setup>
import { onMounted, ref } from 'vue'
import RailNav from './components/RailNav.vue'
import ChatPane from './components/ChatPane.vue'
import RunBench from './components/RunBench.vue'
import ToastMessage from './components/ToastMessage.vue'
import WorkspaceDialog from './components/WorkspaceDialog.vue'
import HistoryDialog from './components/HistoryDialog.vue'
import { useAgentRun } from './composables/useAgentRun'
import { useTheme } from './composables/useTheme'
import { useToast } from './composables/useToast'

const collapsed = ref(true)
const workspaceDialogOpen = ref(false)
const historyDialogOpen = ref(false)
const {
  msgs, steps, tokens, status, running, newChatBusy, mode, modeBusy, workspace,
  initialize, setMode, run, stop, decide, changeWorkspace, newChat
} = useAgentRun()
const { toggleTheme } = useTheme()
const { text: toastText, show: showToast } = useToast()

onMounted(async () => {
  try {
    await initialize()
  } catch (error) {
    showToast(`连接 Agent 失败：${error.message}`)
  }
})

async function handleMode(next) {
  try {
    await setMode(next)
  } catch (error) {
    showToast(error.message)
  }
}

async function handleNewChat() {
  try {
    if (await newChat()) showToast('记忆已保存，当前对话已归档')
  } catch (error) {
    showToast(`新建对话失败，当前对话未归档：${error.message}`)
  }
}

async function handleWorkspace(path) {
  try {
    await changeWorkspace(path)
    workspaceDialogOpen.value = false
    showToast('工作区已切换')
  } catch (error) {
    showToast(`切换工作区失败：${error.message}`)
  }
}

async function handleStop() {
  try {
    await stop()
  } catch (error) {
    showToast(`中止失败：${error.message}`)
  }
}
</script>

<template>
  <div class="app" :class="{ collapsed }">
    <RailNav
      :running="running"
      :new-chat-busy="newChatBusy"
      @new-chat="handleNewChat"
      @history="historyDialogOpen = true"
      @toggle-theme="toggleTheme" />

    <ChatPane
      :msgs="msgs"
      :running="running"
      :collapsed="collapsed"
      :mode="mode"
      :mode-busy="modeBusy"
      :workspace="workspace"
      @update:mode="handleMode"
      @send="run"
      @stop="handleStop"
      @decide="decide"
      @toggle-bench="collapsed = !collapsed"
      @change-workspace="workspaceDialogOpen = true" />

    <RunBench :steps="steps" :status="status" :tokens="tokens" />
    <WorkspaceDialog
      :open="workspaceDialogOpen"
      :current="workspace"
      @close="workspaceDialogOpen = false"
      @select="handleWorkspace" />
    <HistoryDialog :open="historyDialogOpen" @close="historyDialogOpen = false" />
    <ToastMessage :text="toastText" />
  </div>
</template>
