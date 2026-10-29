<script setup>
import { ref, watch } from 'vue'
import { getDirectories } from '../api'

const props = defineProps({
  open: Boolean,
  current: { type: String, default: '' }
})
const emit = defineEmits(['close', 'select'])

const currentPath = ref('')
const manualPath = ref('')
const parent = ref(null)
const directories = ref([])
const loading = ref(false)
const error = ref('')
let requestId = 0

watch(() => props.open, (open) => {
  if (open) load(props.current)
}, { immediate: true })

async function load(path) {
  if (!path) return
  const id = ++requestId
  loading.value = true
  error.value = ''
  try {
    const data = await getDirectories(path)
    if (id !== requestId) return
    currentPath.value = data.path
    manualPath.value = data.path
    parent.value = data.parent
    directories.value = data.directories
  } catch (err) {
    if (id === requestId) error.value = err.message
  } finally {
    if (id === requestId) loading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
      <section class="workspace-dialog" role="dialog" aria-modal="true" aria-label="选择工作区">
        <header class="dialog-head">
          <h2>选择工作区</h2>
          <button title="关闭" @click="emit('close')">×</button>
        </header>

        <form class="path-form" @submit.prevent="load(manualPath.trim())">
          <input v-model="manualPath" aria-label="文件夹绝对路径" placeholder="输入文件夹绝对路径">
          <button class="primary" type="submit" :disabled="loading">打开</button>
        </form>

        <div class="directory-toolbar">
          <button :disabled="!parent || loading" @click="load(parent)">返回上级</button>
          <span>共 {{ directories.length }} 个文件夹</span>
        </div>

        <div class="directory-list">
          <div v-if="loading" class="empty">正在读取目录</div>
          <div v-else-if="error" class="empty err">{{ error }}</div>
          <div v-else-if="!directories.length" class="empty">此目录没有可进入的子文件夹</div>
          <template v-else>
            <button
              v-for="directory in directories"
              :key="directory.path"
              class="directory-item"
              @click="load(directory.path)">
              <span class="folder-icon" aria-hidden="true"></span>
              <span>{{ directory.name }}</span>
              <span class="directory-enter">进入</span>
            </button>
          </template>
        </div>

        <footer class="dialog-actions">
          <button @click="emit('close')">取消</button>
          <button class="primary" :disabled="!currentPath || loading" @click="emit('select', currentPath)">选择此文件夹</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
