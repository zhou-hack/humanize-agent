<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { fetchConnectionModels, getConnection, saveConnection } from '../api'

const props = defineProps({ open: Boolean, running: Boolean })
const emit = defineEmits(['close', 'saved'])
const draft = reactive(createDraft())
const original = ref(null)
const models = ref([])
const loading = ref(false)
const fetching = ref(false)
const saving = ref(false)
const error = ref('')
const modelStatus = ref('')
let loadRequestId = 0
let modelRequestId = 0

const busy = computed(() => loading.value || fetching.value || saving.value)
const hasDraftKey = computed(() => Boolean(
  draft.api_key.trim() || (original.value?.provider === draft.provider && original.value?.has_api_key)
))
const dirty = computed(() => {
  if (!original.value) return false
  if (draft.api_key.trim()) return true
  return ['provider', 'base_url', 'model', 'api_mode', 'max_tokens', 'temperature']
    .some(key => draft[key] !== original.value[key])
})
const temperatureMax = computed(() => draft.provider === 'openai' ? 2 : 1)
const temperatureValid = computed(() => {
  if (draft.temperature === '') return true
  const value = Number(draft.temperature)
  return Number.isFinite(value) && value >= 0 && value <= temperatureMax.value
})
const canSave = computed(() => (
  !busy.value && !props.running && dirty.value && Boolean(draft.model.trim())
  && Number.isInteger(Number(draft.max_tokens)) && Number(draft.max_tokens) > 0
  && hasDraftKey.value && temperatureValid.value
))
const sourceLabel = computed(() => {
  if (!original.value) return ''
  return original.value.source === 'saved' ? '本地已保存' : '来自 .env'
})
const blockReason = computed(() => {
  if (props.running) return '任一任务运行期间不能保存连接设置'
  if (loading.value || saving.value) return ''
  if (!original.value) return '连接配置读取失败，请关闭后重试'
  if (!dirty.value) return '修改任意一项后即可保存'
  if (!hasDraftKey.value) return '请填写 API Key'
  if (!draft.model.trim()) return '请填写或抓取模型'
  if (!Number.isInteger(Number(draft.max_tokens)) || Number(draft.max_tokens) < 1) return '最大输出 Tokens 必须是正整数'
  if (!temperatureValid.value) return `Temperature 需在 0 到 ${temperatureMax.value} 之间`
  return ''
})

watch(() => props.open, (open) => {
  if (open) load()
  else {
    loadRequestId++
    modelRequestId++
    draft.api_key = ''
    fetching.value = false
    error.value = ''
    modelStatus.value = ''
  }
})

onMounted(() => document.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown)
  draft.api_key = ''
})

function createDraft() {
  return { provider: 'openai', api_key: '', base_url: '', model: '', api_mode: 'responses', max_tokens: 4096, temperature: '' }
}

async function load() {
  const id = ++loadRequestId
  loading.value = true
  fetching.value = false
  original.value = null
  Object.assign(draft, createDraft())
  error.value = ''
  modelStatus.value = ''
  models.value = []
  try {
    const config = await getConnection()
    if (id !== loadRequestId) return
    original.value = { ...config, temperature: config.temperature ?? '' }
    Object.assign(draft, {
      provider: config.provider,
      api_key: '',
      base_url: config.base_url,
      model: config.model,
      api_mode: config.api_mode,
      max_tokens: config.max_tokens,
      temperature: config.temperature ?? ''
    })
  } catch (err) {
    if (id === loadRequestId) error.value = err.message
  } finally {
    if (id === loadRequestId) loading.value = false
  }
}

function providerChanged() {
  draft.api_key = ''
  models.value = []
  modelStatus.value = ''
  error.value = ''
  if (original.value && original.value.provider === draft.provider) {
    draft.base_url = original.value.base_url
    draft.model = original.value.model
    draft.api_mode = original.value.api_mode
    draft.max_tokens = original.value.max_tokens
    draft.temperature = original.value.temperature ?? ''
  } else {
    draft.base_url = ''
    draft.model = ''
    draft.api_mode = 'responses'
  }
}

function payload() {
  return {
    provider: draft.provider,
    api_key: draft.api_key.trim(),
    base_url: draft.base_url.trim(),
    model: draft.model.trim(),
    api_mode: draft.api_mode,
    max_tokens: Number(draft.max_tokens),
    temperature: draft.temperature === '' ? null : Number(draft.temperature)
  }
}

async function fetchModels() {
  if (busy.value || props.running) return
  if (!hasDraftKey.value) {
    error.value = '请先填写 API Key，再抓取模型'
    return
  }
  const id = ++modelRequestId
  fetching.value = true
  error.value = ''
  modelStatus.value = ''
  try {
    const data = await fetchConnectionModels(payload())
    if (id !== modelRequestId) return
    models.value = data.models
    modelStatus.value = data.models.length
      ? `已抓取 ${data.models.length} 个模型，点击下方模型名称即可选用`
      : '接口未返回模型，请手动输入模型名称'
  } catch (err) {
    if (id === modelRequestId) {
      models.value = []
      error.value = `抓取模型失败：${err.message}`
    }
  } finally {
    if (id === modelRequestId) fetching.value = false
  }
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = ''
  try {
    const result = await saveConnection(payload())
    original.value = { ...result.connection, temperature: result.connection.temperature ?? '' }
    draft.api_key = ''
    emit('saved', result)
    emit('close')
  } catch (err) {
    error.value = `保存失败：${err.message}`
  } finally {
    saving.value = false
  }
}

function close() {
  if (!saving.value) emit('close')
}
function onKeyDown(event) {
  if (event.key === 'Escape' && props.open) close()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" @click.self="close">
      <section class="workspace-dialog connection-dialog" role="dialog" aria-modal="true" aria-label="连接设置">
        <header class="dialog-head">
          <div>
            <h2>连接设置 <span v-if="sourceLabel" class="connection-source">{{ sourceLabel }}</span></h2>
            <p>仅保存配置，不代表接口连通性已验证；保存后用于新的 Agent 请求</p>
          </div>
          <button type="button" title="关闭" :disabled="saving" @click="close">×</button>
        </header>

        <div class="connection-body">
          <div v-if="loading" class="empty">正在读取连接配置</div>
          <form v-else id="connection-settings-form" @submit.prevent="save">
            <fieldset class="connection-grid" :disabled="busy || running">
              <label class="connection-field">
                <span>提供商</span>
                <select v-model="draft.provider" @change="providerChanged"><option value="openai">OpenAI 兼容接口</option><option value="anthropic">Anthropic</option></select>
              </label>
              <label v-if="draft.provider === 'openai'" class="connection-field">
                <span>接口模式</span>
                <select v-model="draft.api_mode"><option value="responses">Responses API</option><option value="chat_completions">Chat Completions API</option></select>
                <small class="connection-note">第三方兼容接口通常选 Chat Completions API</small>
              </label>
              <label class="connection-field full">
                <span>API Key</span>
                <input
                  v-model="draft.api_key"
                  type="password"
                  autocomplete="new-password"
                  spellcheck="false"
                  :placeholder="original?.provider === draft.provider && original?.has_api_key ? '已保存，留空保持不变' : '输入 API Key'">
                <small class="connection-note">仅作为本次密码草稿提交，不回显，也不写入浏览器本地存储</small>
              </label>
              <label class="connection-field full">
                <span>接口地址</span>
                <input v-model="draft.base_url" type="url" autocomplete="off" spellcheck="false" placeholder="留空使用官方地址，兼容接口地址通常包含 /v1">
              </label>
              <div class="connection-field full">
                <span>模型</span>
                <div class="model-fetch-row">
                  <input v-model="draft.model" list="connection-model-options" required autocomplete="off" spellcheck="false" placeholder="输入模型名称或先抓取模型">
                  <datalist id="connection-model-options"><option v-for="item in models" :key="item" :value="item" /></datalist>
                  <button type="button" :disabled="busy || running" @click="fetchModels">{{ fetching ? '抓取中…' : '抓取模型' }}</button>
                </div>
                <div v-if="models.length" class="model-options">
                  <button v-for="item in models" :key="item" type="button" class="model-option" :class="{ active: draft.model === item }" @click="draft.model = item">{{ item }}</button>
                </div>
              </div>
              <label class="connection-field"><span>最大输出 Tokens</span><input v-model.number="draft.max_tokens" type="number" min="1" step="1" required></label>
              <label class="connection-field"><span>Temperature</span><input v-model.number="draft.temperature" type="number" min="0" :max="temperatureMax" step="0.1" placeholder="默认"></label>
            </fieldset>
            <p v-if="running" class="connection-hint">任一任务运行期间不能保存连接设置</p>
            <p v-else-if="modelStatus" class="connection-hint">{{ modelStatus }}</p>
            <p v-else-if="blockReason" class="connection-hint">{{ blockReason }}</p>
            <p v-if="error" class="connection-error" role="alert">{{ error }}</p>
          </form>
        </div>
        <footer class="dialog-actions">
          <button type="button" :disabled="saving" @click="close">取消</button>
          <button class="primary" type="submit" form="connection-settings-form" :disabled="!canSave">{{ saving ? '保存中…' : '保存配置' }}</button>
        </footer>
      </section>
      </div>
    </Transition>
  </Teleport>
</template>
