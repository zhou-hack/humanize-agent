export async function getState() {
  const response = await fetch('/api/state')
  return expectJson(response)
}

export async function getDirectories(path) {
  const response = await fetch(`/api/directories?path=${encodeURIComponent(path)}`)
  return expectJson(response)
}

export async function getHistory(cursor) {
  const params = new URLSearchParams()
  if (cursor) {
    params.set('before', String(cursor.last_message_at))
    params.set('before_id', cursor.id)
  }
  const query = params.toString()
  const response = await fetch(`/api/history${query ? `?${query}` : ''}`)
  return expectJson(response)
}

export async function getHistoryMessages(id, offset = 0) {
  const params = new URLSearchParams({ offset: String(offset) })
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

export async function streamAgentRun(text, { signal, effort, onEvent }) {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, ...(effort ? { effort } : {}) }),
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
