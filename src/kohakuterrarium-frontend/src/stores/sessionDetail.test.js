import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useSessionDetailStore } from "./sessionDetail.js"
import { sessionAPI } from "@/utils/api"

vi.mock("@/utils/api", () => ({
  sessionAPI: {
    getHistoryIndex: vi.fn(),
    getTree: vi.fn().mockResolvedValue(null),
    getSummary: vi.fn().mockResolvedValue(null),
  },
}))

beforeEach(() => {
  setActivePinia(createPinia())
  sessionAPI.getHistoryIndex.mockReset().mockResolvedValue({ meta: {}, targets: [] })
  sessionAPI.getTree.mockReset().mockResolvedValue(null)
  sessionAPI.getSummary.mockReset().mockResolvedValue(null)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe("sessionDetail current discovery identity", () => {
  it.each(["success", "error"])(
    "ignores old %s/catch/finally across A-B-A and independent scopes",
    async (outcome) => {
      const old = [deferred(), deferred(), deferred()]
      sessionAPI.getHistoryIndex.mockReturnValueOnce(old[0].promise)
      sessionAPI.getTree.mockReturnValueOnce(old[1].promise)
      sessionAPI.getSummary.mockReturnValueOnce(old[2].promise)
      const detail = useSessionDetailStore("binding")
      const first = detail.load("A")
      await detail.load("B")
      const current = [deferred(), deferred(), deferred()]
      sessionAPI.getHistoryIndex.mockReturnValueOnce(current[0].promise)
      sessionAPI.getTree.mockReturnValueOnce(current[1].promise)
      sessionAPI.getSummary.mockReturnValueOnce(current[2].promise)
      const third = detail.load("A")
      const other = useSessionDetailStore("other")
      sessionAPI.getSummary.mockResolvedValueOnce({ agents: ["separate"] })
      await other.load("A")
      if (outcome === "error") old.forEach((request) => request.reject(new Error("stale")))
      else
        old.forEach((request) =>
          request.resolve({ meta: { agents: ["old"] }, targets: ["old"], agents: ["old"] }),
        )
      await first
      expect(detail.bindingGeneration).toBe(3)
      expect(detail.meta).toBeNull()
      expect(detail.tree).toBeNull()
      expect(detail.summary).toBeNull()
      expect(detail.error).toBe("")
      expect(detail.summaryError).toBe("")
      expect([detail.loadingMeta, detail.loadingTree, detail.loadingSummary]).toEqual([
        true,
        true,
        true,
      ])
      expect(detail.traceDiscovery.status).toBe("pending")
      current[0].resolve({ meta: { agents: ["alice"] }, targets: ["alice"] })
      current[1].resolve({ name: "new tree" })
      current[2].resolve({ agents: ["bob"] })
      await third
      expect(detail.traceDiscovery).toEqual({ status: "ready", agent: "bob" })
      expect(detail.tree).toEqual({ name: "new tree" })
      expect([detail.loadingMeta, detail.loadingTree, detail.loadingSummary]).toEqual([
        false,
        false,
        false,
      ])
      expect(other.traceDiscovery).toEqual({ status: "ready", agent: "separate" })
    },
  )

  it("separates filtered summary display from current unfiltered discovery, including a refresh", async () => {
    const detail = useSessionDetailStore()
    const summary = deferred()
    sessionAPI.getSummary.mockReturnValueOnce(summary.promise)
    const load = detail.load("A")
    sessionAPI.getSummary.mockResolvedValueOnce({ agents: ["filtered"] })
    await detail.loadSummary("filtered")
    expect(detail.summary.agents).toEqual(["filtered"])
    expect(detail.traceDiscovery.status).toBe("pending")
    summary.resolve({ agents: ["ch:team", "bob", "alice"] })
    await load
    expect(detail.summary.agents).toEqual(["filtered"])
    expect(detail.traceDiscovery).toEqual({ status: "ready", agent: "bob" })
    const stale = deferred(),
      fresh = deferred()
    sessionAPI.getSummary.mockReturnValueOnce(stale.promise)
    const previous = detail.loadSummary()
    sessionAPI.getSummary.mockReturnValueOnce(fresh.promise)
    const reload = detail.load("A")
    stale.resolve({ agents: ["old"] })
    await previous
    expect(detail.traceDiscovery.status).toBe("pending")
    expect(detail.loadingSummary).toBe(true)
    fresh.resolve({ agents: ["fresh"] })
    await reload
    expect(detail.traceDiscovery).toEqual({ status: "ready", agent: "fresh" })
    expect(detail.bindingGeneration).toBe(1)
    expect(detail.loadEpoch).toBe(2)
  })

  it("uses only settled valid index candidates and honors an eligible preferred fallback", async () => {
    const detail = useSessionDetailStore()
    sessionAPI.getSummary.mockRejectedValueOnce(new Error("summary failed"))
    sessionAPI.getHistoryIndex.mockResolvedValueOnce({
      targets: ["ch:team", "alice", "alice", null],
      meta: { agents: ["bob", "alice"], viewer_default_agent: "bob" },
    })
    await detail.load("A")
    expect(detail.traceDiscovery).toEqual({ status: "ready", agent: "bob" })
    expect(detail.summaryStatus).toBe("error")
    expect(detail.summaryError).toContain("summary failed")
    sessionAPI.getHistoryIndex.mockResolvedValueOnce({
      targets: ["alice"],
      meta: { viewer_default_agent: "unknown-attached" },
    })
    await detail.load("A")
    expect(detail.traceDiscovery).toEqual({ status: "ready", agent: "alice" })
  })
})

describe("sessionDetail store — agents getter (UXI-03)", () => {
  it("enumerates every creature, not just root, unioning summary + targets", () => {
    const detail = useSessionDetailStore("s1")
    detail.meta = { agents: ["root"] }
    detail.targets = ["root", "worker_a", "ch:team"]
    detail.summary = { agents: ["root", "worker_b"] }
    // Summary first (viewer-default ordering), then targets, deduped;
    // the ``ch:`` channel target is excluded.
    expect(detail.agents).toEqual(["root", "worker_b", "worker_a"])
    expect(detail.primaryAgent).toBe("root")
  })

  it("falls back to meta.agents before summary/targets load", () => {
    const detail = useSessionDetailStore("s2")
    detail.meta = { agents: ["alice", "bob"] }
    detail.targets = []
    detail.summary = null
    expect(detail.agents).toEqual(["alice", "bob"])
  })

  it("returns an empty list when nothing is loaded", () => {
    const detail = useSessionDetailStore("s3")
    expect(detail.agents).toEqual([])
    expect(detail.primaryAgent).toBeNull()
  })
})

describe("sessionDetail store — loadMeta (UXI-01)", () => {
  it("treats a 404 from the live-id index as a benign empty state", async () => {
    const { sessionAPI } = await import("@/utils/api")
    sessionAPI.getHistoryIndex.mockRejectedValueOnce({ response: { status: 404 } })
    const detail = useSessionDetailStore("live1")
    detail.name = "live_graph_new"
    await detail.loadMeta()
    expect(detail.error).toBe("")
    expect(detail.meta).toBeNull()
    expect(detail.targets).toEqual([])
  })

  it("still surfaces a non-404 failure as an error", async () => {
    const { sessionAPI } = await import("@/utils/api")
    sessionAPI.getHistoryIndex.mockRejectedValueOnce({ response: { status: 500 }, message: "boom" })
    const detail = useSessionDetailStore("live2")
    detail.name = "broken_session"
    await detail.loadMeta()
    expect(detail.error).toContain("Failed to load session metadata")
  })
})
