/**
 * Per-chatId serial message queue.
 * Ensures messages from the same Feishu chat are processed in order,
 * preventing race conditions when creating Brain sessions.
 */

type QueueTask = () => Promise<void>

export class FeishuMessageQueue {
    private queues: Map<string, QueueTask[]> = new Map()
    private processing: Set<string> = new Set()

    async enqueue(chatId: string, task: QueueTask): Promise<void> {
        const queue = this.queues.get(chatId) || []
        queue.push(task)
        this.queues.set(chatId, queue)

        if (!this.processing.has(chatId)) {
            await this.processQueue(chatId)
        }
    }

    private async processQueue(chatId: string): Promise<void> {
        if (this.processing.has(chatId)) return
        this.processing.add(chatId)

        try {
            while (true) {
                const queue = this.queues.get(chatId)
                if (!queue || queue.length === 0) {
                    this.queues.delete(chatId)
                    break
                }
                const task = queue.shift()!
                try {
                    await task()
                } catch (error) {
                    console.error(`[FeishuBot] Queue task failed for chat ${chatId}:`, error)
                }
            }
        } finally {
            this.processing.delete(chatId)
        }
    }

    clear(): void {
        this.queues.clear()
        this.processing.clear()
    }
}
