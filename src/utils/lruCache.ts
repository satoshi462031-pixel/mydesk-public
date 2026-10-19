export class LruCache<K, V> {
  private readonly values = new Map<K, V>()

  constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('maxEntries must be a positive integer')
    }
  }

  get(key: K): V | undefined {
    const value = this.values.get(key)
    if (value === undefined) return undefined
    this.values.delete(key)
    this.values.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    this.values.delete(key)
    this.values.set(key, value)
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value as K | undefined
      if (oldest === undefined) break
      this.values.delete(oldest)
    }
  }

  get size(): number {
    return this.values.size
  }
}
