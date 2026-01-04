import type { Store } from '../store'

export interface InjectedMemory {
  type: string
  content: string
  importance: number
}

export async function getMemoriesForInjection(
  store: Store,
  namespace: string,
  profileId: string,
  limit: number = 10
): Promise<InjectedMemory[]> {
  const memories = store.getProfileMemories(namespace, profileId, {
    limit,
    minImportance: 0.3
  })

  // 更新访问记录
  for (const mem of memories) {
    store.updateMemoryAccess(namespace, mem.id)
  }

  return memories.map(m => ({
    type: m.memoryType,
    content: m.content,
    importance: m.importance
  }))
}

export function formatMemoriesForPrompt(memories: InjectedMemory[]): string {
  if (memories.length === 0) return ''

  const lines = memories.map(m => `- [${m.type}] ${m.content}`)
  return `\n## 历史记忆\n${lines.join('\n')}\n`
}
