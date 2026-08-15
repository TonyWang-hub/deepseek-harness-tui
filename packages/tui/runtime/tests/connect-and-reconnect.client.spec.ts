/**
 * Real-composition slice: dual-context boot with no listening socket, the
 * Client tree's full ready handshake over the in-process transport, one
 * Typert Remote call, and dependency-driven recomposition — the landing-order slice
 * this package exists to prove (see the official-terminal-application Agent
 * Note). Only Client-half symbols and this package's own exports are
 * imported statically; the Host tree is resolved by the real Loader from
 * package NAMES in `compose.client.ts`, never by static import.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import '@deepseek-ai/dsh-tui-runtime'
import { bootHostTree, type ComposedTree } from './compose.client.ts'

/** `net.Server`-shaped active handle (the private, unstable but conventional Node introspection point). */
interface ServerLikeHandle {
  listening?: unknown
  address?: unknown
}

function activeServerHandles(): unknown[] {
  const getActiveHandles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles
  if (getActiveHandles === undefined) throw new Error('process._getActiveHandles is unavailable on this Node build')
  return getActiveHandles.call(process).filter((handle): handle is ServerLikeHandle => {
    if (typeof handle !== 'object' || handle === null) return false
    const candidate = handle as ServerLikeHandle
    return typeof candidate.listening === 'boolean' && typeof candidate.address === 'function'
  })
}

describe('tui-runtime: dual-context boot, ready handshake, Typert Remote, recomposition', () => {
  let tree: ComposedTree
  let clientCtx: Context
  let connection: ConnectionHandle

  beforeAll(async () => {
    tree = await bootHostTree()
    clientCtx = tree.ctx.tuiRuntime.clientCtx
    connection = clientCtx.get('connection') as ConnectionHandle
  }, 30_000)

  afterAll(async () => {
    await tree.dispose()
  })

  it('opens no listening socket for the whole composed Host tree', () => {
    expect(activeServerHandles()).toEqual([])
  })

  it('completes the ready handshake and answers one Typert Remote call', async () => {
    await vi.waitFor(() => {
      expect(connection.hostDescription.getSnapshot()).not.toBeUndefined()
    }, { timeout: 5_000, interval: 20 })

    const created = await connection.api.sessions.create({})
    if (!created.result.ok) throw new Error(`session.create failed: ${created.result.error.code}`)
    const { sessionId } = created.result.value

    const commands = await connection.rpc.call('/api', 'commands/list', { args: { agentId: sessionId } })
    if (!commands.ok) throw new Error(`commands/list failed: ${JSON.stringify(commands.error)}`)
    const names = (commands.value as { name: string }[]).map(entry => entry.name)
    expect(names).toContain('compact')
  })

  it('recomposes the Client tree after the ApiProxy fiber returns', async () => {
    const firstRuntime = tree.ctx.tuiRuntime
    // Withdraw the ApiProxy fiber by disabling its row (its Loader entry
    // stays addressable at the same local id, unlike remove()+create():
    // a freshly created entry's `.id` getter composes the owning
    // `cordis:include` entry's own qualified id as a prefix, which
    // `EntryTree.create()`'s self-resolve step then cannot resolve back
    // against this same nested tree — update() takes the plain local id
    // directly, so it has no such issue).
    await tree.rows.update('api-gateway', { disabled: true })
    await vi.waitFor(() => {
      expect(tree.ctx.get('tuiRuntime')).toBeUndefined()
    }, { timeout: 10_000, interval: 20 })

    await tree.rows.update('api-gateway', { disabled: false })
    await vi.waitFor(() => {
      expect(tree.ctx.get('tuiRuntime')).toBeDefined()
      expect(tree.ctx.get('tuiRuntime')).not.toBe(firstRuntime)
    }, { timeout: 10_000, interval: 20 })

    clientCtx = tree.ctx.tuiRuntime.clientCtx
    connection = clientCtx.get('connection') as ConnectionHandle
    await vi.waitFor(() => {
      expect(connection.hostDescription.getSnapshot()).not.toBeUndefined()
    }, { timeout: 10_000, interval: 20 })

    const created = await connection.api.sessions.create({})
    if (!created.result.ok) throw new Error(`session.create after recompose failed: ${created.result.error.code}`)
    const commands = await connection.rpc.call('/api', 'commands/list', { args: { agentId: created.result.value.sessionId } })
    if (!commands.ok) throw new Error(`commands/list after recompose failed: ${commands.error.code}`)
    expect((commands.value as { name: string }[]).length).toBeGreaterThan(0)
  }, 30_000)
})
