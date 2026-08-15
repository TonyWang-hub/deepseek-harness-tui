import { describe, expect, it } from 'vitest'
import { createRowCache } from '../../src/transcript/row-cache.ts'

describe('createRowCache', () => {
  it('misses on an unset key', () => {
    const cache = createRowCache(10)
    expect(cache.get('a', 80)).toBeUndefined()
  })

  it('hits after a set at the same key and width', () => {
    const cache = createRowCache(10)
    cache.set('a', 80, ['line one'])
    expect(cache.get('a', 80)).toEqual(['line one'])
  })

  it('misses at a different width for the same key (width-keyed)', () => {
    const cache = createRowCache(10)
    cache.set('a', 80, ['line one'])
    expect(cache.get('a', 100)).toBeUndefined()
  })

  it('evicts the least recently used entry once over capacity', () => {
    const cache = createRowCache(2)
    cache.set('a', 80, ['a'])
    cache.set('b', 80, ['b'])
    cache.set('c', 80, ['c']) // evicts 'a' (oldest, never re-gotten)
    expect(cache.get('a', 80)).toBeUndefined()
    expect(cache.get('b', 80)).toEqual(['b'])
    expect(cache.get('c', 80)).toEqual(['c'])
  })

  it('a get() refreshes recency, protecting that entry from the next eviction', () => {
    const cache = createRowCache(2)
    cache.set('a', 80, ['a'])
    cache.set('b', 80, ['b'])
    cache.get('a', 80) // 'a' is now more recently used than 'b'
    cache.set('c', 80, ['c']) // evicts 'b', not 'a'
    expect(cache.get('a', 80)).toEqual(['a'])
    expect(cache.get('b', 80)).toBeUndefined()
    expect(cache.get('c', 80)).toEqual(['c'])
  })

  it('re-setting the same key/width updates its value without growing the cache', () => {
    const cache = createRowCache(2)
    cache.set('a', 80, ['a1'])
    cache.set('a', 80, ['a2'])
    expect(cache.get('a', 80)).toEqual(['a2'])
  })

  it('uses the default capacity when none is given', () => {
    const cache = createRowCache()
    cache.set('a', 80, ['a'])
    expect(cache.get('a', 80)).toEqual(['a'])
  })
})
