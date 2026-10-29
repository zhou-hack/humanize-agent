import { cp, lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const source = path.join(projectRoot, 'src', 'data', 'tools')
const destination = path.join(projectRoot, 'dist', 'data', 'tools')

await mkdir(destination, { recursive: true })
await cp(source, destination, {
  recursive: true,
  force: true,
  filter: async (entry) => {
    const stat = await lstat(entry)
    if (stat.isDirectory()) return true
    return path.basename(entry) === 'SKILL.md' || path.extname(entry) === '.json'
  }
})
