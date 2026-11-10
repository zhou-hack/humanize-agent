export async function getState(mode = 'chat') {
  const response = await fetch(`/api/state?mode=${encodeURIComponent(mode)}`)
  return expectJson(response)
}

export async function getConnection() {
  const response = await fetch('/api/connection')
  return expectJson(response)
}

export async function fetchConnectionModels(config) {
  return postJson('/api/connection/models', config)
}

export async function saveConnection(config) {
  return postJson('/api/connection', config)
}

export async function getDirectories(path) {
  const response = await fetch(`/api/directories?path=${encodeURIComponent(path)}`)
  return expectJson(response)
}

export async function getHistory(cursor, mode = 'chat', limit = 30) {
  const params = new URLSearchParams({ mode, limit: String(limit) })
  if (cursor) {
    params.set('before', String(cursor.last_message_at))
    params.set('before_id', cursor.id)
  }
  const response = await fetch(`/api/history?${params}`)
  return expectJson(response)
}

export async function getHistoryMessages(id, offset = 0, mode = 'chat') {
  const params = new URLSearchParams({ mode, offset: String(offset) })
  const response = await fetch(`/api/history/${encodeURIComponent(id)}/messages?${params}`)
  return expectJson(response)
}

export async function postJson(path, body = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return expectJson(response)
}

export async function streamAgentRun(text, { signal, effort, mode = 'chat', onEvent }) {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode, ...(effort ? { effort } : {}) }),
    signal
  })
  if (!response.ok) await throwResponseError(response)
  if (!response.body) throw new Error('浏览器不支持流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    buffer = buffer.replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      dispatchBlock(block, onEvent)
      boundary = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  if (buffer.trim()) dispatchBlock(buffer, onEvent)
}

async function expectJson(response) {
  if (!response.ok) await throwResponseError(response)
  return response.json()
}

async function throwResponseError(response) {
  const body = await response.json().catch(() => null)
  throw new Error(body?.error ?? `请求失败（HTTP ${response.status}）`)
}

function dispatchBlock(block, onEvent) {
  let type = 'message'
  const data = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim()
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!data.length) return
  const payload = JSON.parse(data.join('\n'))
  onEvent({ type, ...payload })
}
