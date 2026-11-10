import { ToolError } from '../tools/tool_calling/errors.js'

export function assertVector(vector: Float32Array, dimensions?: number): void {
  if (vector.length === 0 || (dimensions !== undefined && vector.length !== dimensions)) {
    throw new ToolError('invalid_args', 'Embedding 向量维度无效')
  }
  let squaredNorm = 0
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new ToolError('invalid_args', 'Embedding 向量包含非有限数值')
    }
    squaredNorm += value * value
  }
  if (squaredNorm === 0) {
    throw new ToolError('invalid_args', 'Embedding 向量不能是零向量')
  }
}

export function encodeVector(vector: Float32Array): Buffer {
  assertVector(vector)
  const bytes = Buffer.alloc(vector.length * 4)
  for (let index = 0; index < vector.length; index += 1) {
    bytes.writeFloatLE(vector[index] as number, index * 4)
  }
  return bytes
}

export function decodeVector(data: Uint8Array, dimensions?: number): Float32Array {
  if (data.byteLength % 4 !== 0 || (dimensions !== undefined && data.byteLength !== dimensions * 4)) {
    throw new ToolError('internal', '知识库向量字节长度无效')
  }
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const vector = new Float32Array(data.byteLength / 4)
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = bytes.readFloatLE(index * 4)
  }
  try {
    assertVector(vector, dimensions)
  } catch (error) {
    if (error instanceof ToolError) {
      throw new ToolError('internal', `知识库向量已损坏：${error.message}`)
    }
    throw error
  }
  return vector
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new ToolError('invalid_args', '余弦相似度要求两个等长非空向量')
  }
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] as number
    const rightValue = right[index] as number
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}
