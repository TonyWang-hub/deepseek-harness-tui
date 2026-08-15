import { describe, expect, it } from 'vitest'
import { classifySnapshotUpdate, type ClassifiableSnapshot } from '../../src/scheduler/classify-update.ts'

function baseSnapshot(): ClassifiableSnapshot {
  return {
    pending: [],
    running: false,
    turnEnds: new Map(),
    nodes: [],
    queue: [],
    runningCalls: [],
  }
}

describe('classifySnapshotUpdate', () => {
  it('classifies an unchanged snapshot as stream', () => {
    const snapshot = baseSnapshot()
    expect(classifySnapshotUpdate(snapshot, { ...snapshot })).toBe('stream')
  })

  it('classifies a pending-count change as structural', () => {
    const previous = baseSnapshot()
    const next = { ...previous, pending: [{ kind: 'approval' }] as unknown as ClassifiableSnapshot['pending'] }
    expect(classifySnapshotUpdate(previous, next)).toBe('structural')
  })

  it('classifies a running-flag change as structural', () => {
    const previous = baseSnapshot()
    const next = { ...previous, running: true }
    expect(classifySnapshotUpdate(previous, next)).toBe('structural')
  })

  it('classifies a turnEnds-size change as structural', () => {
    const previous = baseSnapshot()
    const next = { ...previous, turnEnds: new Map([[0, 10]]) }
    expect(classifySnapshotUpdate(previous, next)).toBe('structural')
  })

  it('classifies a nodes-length change (a closed node committed) as structural', () => {
    const previous = baseSnapshot()
    const next = { ...previous, nodes: [{}] as unknown as ClassifiableSnapshot['nodes'] }
    expect(classifySnapshotUpdate(previous, next)).toBe('structural')
  })

  it('classifies a queue-length change as structural', () => {
    const previous = baseSnapshot()
    const next = { ...previous, queue: [{}] as unknown as ClassifiableSnapshot['queue'] }
    expect(classifySnapshotUpdate(previous, next)).toBe('structural')
  })

  it('classifies a runningCalls-length change as structural', () => {
    const previous = baseSnapshot()
    const next = { ...previous, runningCalls: [{}] as unknown as ClassifiableSnapshot['runningCalls'] }
    expect(classifySnapshotUpdate(previous, next)).toBe('structural')
  })
})
