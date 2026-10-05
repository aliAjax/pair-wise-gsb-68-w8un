import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedAudit, seedClaims, seedVersions } from '../data/seed'
import { isHashPending, makeSnapshot, normalizeHash, pinFactVersion, processIntakeBatch, publishGate, sourceKeyOf } from '../services/intakeChain'
import type {
  AuditEntry,
  Claim,
  ClaimAnnotation,
  ClaimFact,
  FactConclusion,
  IntakeBatch,
  IntakeBatchInput,
  PublishedSnapshot,
  SourceRecord,
  SourceVersion,
  VersionRecord
} from '../types'

interface ClaimState {
  claims: Claim[]
  versions: VersionRecord[]
  audit: AuditEntry[]
  /** 来源版本库：公开地址 -> 按内容哈希保留的多版来源 */
  sourceRegistry: SourceVersion[]
  /** 完整收件批次（含部分失败批次），用于写入失败后恢复 */
  intakeBatches: IntakeBatch[]
  /** 发布快照，撤回件到达后仍可追 */
  publishedSnapshots: PublishedSnapshot[]
  keyword: string
  status: Claim['status'] | '全部'
  setKeyword: (value: string) => void
  setStatus: (value: Claim['status'] | '全部') => void
  addClaim: (input: { title: string; summary: string; reporter: string; priority: Claim['priority'] }) => Claim
  updateFact: (claimId: string, factId: string, patch: Partial<ClaimFact>) => void
  addFact: (claimId: string, text: string) => void
  addAnnotation: (claimId: string, factId: string, annotation: Omit<ClaimAnnotation, 'id' | 'createdAt' | 'resolved'>) => void
  resolveAnnotation: (claimId: string, factId: string, annotationId: string) => void
  addSource: (claimId: string, factId: string, source: Omit<SourceRecord, 'id' | 'capturedAt' | 'version'>, counter: boolean) => { ok: boolean; message: string }
  pinSourceVersion: (claimId: string, factId: string, sourceKey: string, hash: string) => void
  ingestBatch: (input: IntakeBatchInput) => { ok: boolean; message: string }
  recoverBatch: (batchId: string) => { ok: boolean; message: string }
  transitionClaim: (claimId: string, status: Claim['status'], note: string) => { ok: boolean; message: string }
  reset: () => void
}

let idSeed = 100
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${idSeed++}`

function audit(claimId: string, action: string, operator: string, detail: string): AuditEntry {
  return { id: nextId('AUD'), claimId, action, operator, detail, createdAt: new Date().toISOString() }
}

/** 迁移旧数据：把事实里的来源卡片登记进来源版本库，回填 sourceKey/status；缺哈希的置为待核 */
function buildRegistryFromClaims(claims: Claim[]): SourceVersion[] {
  const registry = new Map<string, SourceVersion>()
  for (const claim of claims) {
    for (const fact of claim.facts) {
      for (const source of [...fact.sources, ...fact.counterSources]) {
        const key = sourceKeyOf(source.url)
        source.sourceKey = key
        const pending = isHashPending(source.contentHash)
        if (pending) {
          source.status = '待核'
          source.contentHash = ''
        } else {
          source.contentHash = normalizeHash(source.contentHash)
          source.status = '有效'
        }
        // 旧数据天然钉住其卡片哈希（演示数据都带哈希）；无哈希来源留待人工待核
        fact.versionRefs = { ...(fact.versionRefs ?? {}), ...(pending ? {} : { [key]: source.contentHash }) }

        const mapKey = `${key}|${source.contentHash}`
        const existing = registry.get(mapKey)
        if (existing) {
          existing.receiptCount += 1
          existing.lastReceivedAt = source.capturedAt
        } else {
          registry.set(mapKey, {
            key,
            url: source.url,
            title: source.title,
            publisher: source.publisher,
            publishedAt: source.publishedAt,
            kind: source.kind,
            chainOfCustody: source.chainOfCustody,
            contentHash: source.contentHash,
            status: pending ? '待核' : '有效',
            firstReceivedAt: source.capturedAt,
            lastReceivedAt: source.capturedAt,
            receiptCount: 1,
            verifications: [],
            siblingHashes: []
          })
        }
      }
    }
  }
  const list = [...registry.values()]
  for (const entry of list) {
    entry.siblingHashes = list
      .filter((other) => other.key === entry.key && other !== entry && !isHashPending(other.contentHash))
      .map((other) => other.contentHash)
  }
  return list
}

function migrateSeed(): { claims: Claim[]; registry: SourceVersion[] } {
  const claims = structuredClone(seedClaims)
  const registry = buildRegistryFromClaims(claims)
  return { claims, registry }
}

const initial = migrateSeed()

function chainStateFrom(state: ClaimState) {
  return { registry: state.sourceRegistry, claims: state.claims, snapshots: state.publishedSnapshots }
}

export const useClaimStore = create<ClaimState>()(persist((set, get) => ({
  claims: initial.claims,
  versions: structuredClone(seedVersions),
  audit: structuredClone(seedAudit),
  sourceRegistry: initial.registry,
  intakeBatches: [],
  publishedSnapshots: [],
  keyword: '',
  status: '全部',
  setKeyword: (keyword) => set({ keyword }),
  setStatus: (status) => set({ status }),
  addClaim: (input) => {
    const now = new Date().toISOString()
    const claim: Claim = { id: nextId('FC'), ...input, editor: '宋卓', status: '核查中', createdAt: now, updatedAt: now, version: 1, facts: [] }
    set((state) => ({ claims: [claim, ...state.claims], audit: [audit(claim.id, '建立核查主张', input.reporter, input.summary), ...state.audit] }))
    return claim
  },
  addFact: (claimId, text) => set((state) => {
    const claim = state.claims.find((item) => item.id === claimId)
    if (!claim || !text.trim()) return state
    claim.facts.push({ id: nextId('F'), text, conclusion: '证据不足', confidence: 30, unresolved: ['尚未关联来源'], sources: [], counterSources: [], annotations: [], versionRefs: {}, uncertainRefs: [] })
    claim.version += 1
    claim.updatedAt = new Date().toISOString()
    return { claims: [...state.claims], audit: [audit(claimId, '拆分可验证事实', claim.reporter, text), ...state.audit] }
  }),
  updateFact: (claimId, factId, patch) => set((state) => {
    const claim = state.claims.find((item) => item.id === claimId)
    const fact = claim?.facts.find((item) => item.id === factId)
    if (!claim || !fact) return state
    if (patch.conclusion && patch.conclusion !== '证据不足' && fact.unresolved.length) {
      patch.confidence = Math.min(patch.confidence ?? fact.confidence, 75)
    }
    Object.assign(fact, patch)
    claim.version += 1
    claim.updatedAt = new Date().toISOString()
    return { claims: [...state.claims], audit: [audit(claimId, '更新事实结论', '当前用户', `${fact.text}：${fact.conclusion}`), ...state.audit] }
  }),
  addAnnotation: (claimId, factId, input) => set((state) => {
    const claim = state.claims.find((item) => item.id === claimId)
    const fact = claim?.facts.find((item) => item.id === factId)
    if (!claim || !fact) return state
    fact.annotations.unshift({ ...input, id: nextId('N'), createdAt: new Date().toISOString(), resolved: false })
    return { claims: [...state.claims], audit: [audit(claimId, '添加批注', input.author, input.content), ...state.audit] }
  }),
  resolveAnnotation: (claimId, factId, annotationId) => set((state) => {
    const claim = state.claims.find((item) => item.id === claimId)
    const annotation = claim?.facts.find((item) => item.id === factId)?.annotations.find((item) => item.id === annotationId)
    if (!claim || !annotation) return state
    annotation.resolved = true
    return { claims: [...state.claims], audit: [audit(claimId, '解决批注', '当前用户', annotation.content), ...state.audit] }
  }),
  addSource: (claimId, factId, input, counter) => {
    const state = get()
    const claim0 = state.claims.find((item) => item.id === claimId)
    const fact0 = claim0?.facts.find((item) => item.id === factId)
    if (!claim0 || !fact0) return { ok: false, message: '主张或事实不存在' }
    if (isHashPending(input.contentHash)) {
      return { ok: false, message: '旧来源缺内容哈希：请先走待核收件，补齐哈希前不能直接关联发布' }
    }
    const now = new Date().toISOString()
    const itemId = nextId('ITM')
    const processed = processIntakeBatch(chainStateFrom(state), {
      batchId: nextId('BATCH'),
      source: '人工关联来源',
      arrivedAt: now,
      items: [{
        itemId, kind: 'news', title: input.title, url: input.url, publisher: input.publisher,
        publishedAt: input.publishedAt, evidenceKind: input.kind, chainOfCustody: input.chainOfCustody,
        contentHash: input.contentHash, checker: '陆衡', receivedAt: now
      }]
    })
    const { result, batch } = processed
    if (!result) return { ok: false, message: '收件写入失败' }
    const receipt = result.receipts[0]
    const claim = result.state.claims.find((item) => item.id === claimId)!
    const fact = claim.facts.find((item) => item.id === factId)!
    const key = sourceKeyOf(input.url)
    const list = counter ? fact.counterSources : fact.sources
    const duplicated = list.some((source) => source.sourceKey === key && normalizeHash(source.contentHash) === normalizeHash(input.contentHash))
    if (!duplicated) {
      const source: SourceRecord = {
        ...input, contentHash: normalizeHash(input.contentHash), id: nextId(counter ? 'C' : 'S'), capturedAt: now,
        version: list.filter((item) => item.title === input.title).length + 1, sourceKey: key, status: '有效'
      }
      list.unshift(source)
      fact.versionRefs = { ...(fact.versionRefs ?? {}), [key]: source.contentHash }
    }
    claim.version += 1
    claim.updatedAt = now
    set({
      claims: [...result.state.claims],
      sourceRegistry: result.state.registry,
      intakeBatches: [batch, ...state.intakeBatches],
      audit: [audit(claimId, counter ? '保留相反证据' : '关联来源', '陆衡', `${input.title}：${receipt.result === 'deduped' ? '相同哈希只留一条' : receipt.note}`), ...state.audit]
    })
    return { ok: true, message: receipt.result === 'deduped' ? '相同哈希已存在，只保留一条收件记录' : '来源版本已核验并关联' }
  },
  pinSourceVersion: (claimId, factId, sourceKey, hash) => set((state) => {
    const next = pinFactVersion(chainStateFrom(state), claimId, factId, sourceKey, hash)
    const claim = next.claims.find((item) => item.id === claimId)
    if (claim) {
      claim.version += 1
      claim.updatedAt = new Date().toISOString()
    }
    return {
      claims: [...next.claims],
      sourceRegistry: next.registry,
      audit: [audit(claimId, '钉住来源版本', '当前用户', `${factId} 钉住 ${sourceKey} -> ${hash}`), ...state.audit]
    }
  }),
  ingestBatch: (input) => {
    const state = get()
    const existed = state.intakeBatches.find((batch) => batch.id === input.batchId)
    const { result, batch } = processIntakeBatch(chainStateFrom(state), input, existed)
    if (!result) {
      // 写入失败：保留完整收件批次，只落已完成项回执
      const others = state.intakeBatches.filter((item) => item.id !== batch.id)
      set({ intakeBatches: [batch, ...others] })
      return { ok: false, message: batch.error ?? '批次处理中断' }
    }
    const events = result.events
    const newAudit: AuditEntry[] = []
    for (const event of events) {
      if (event.type === 'fact-uncertain') newAudit.push(audit(event.claimId, '标出不确定引用', '收件链', `${event.factId}：${event.detail}`))
      else if (event.type === 'fact-invalidated') newAudit.push(audit(event.claimId, '撤回失效', '收件链', `${event.factId}：${event.detail}`))
      else if (event.type === 'snapshot-retraction') newAudit.push(audit(event.claimId, '发布快照追踪撤回', '收件链', `快照 ${event.snapshotId} 标记撤回哈希，快照仍可追`))
      else if (event.type === 'recovered') newAudit.push(audit('收件批次', '批次恢复', '收件链', event.detail))
    }
    for (const receipt of result.receipts) {
      if (receipt.result === 'deduped' || receipt.result === 'retraction-deduped') continue
      const action = receipt.kind === 'retraction'
        ? (receipt.result === 'retracted' ? '来源版本撤回' : '撤回件待匹配')
        : '收件登记'
      const operator = receipt.kind === 'retraction' ? '舆情回调' : receipt.checker ?? '舆情回调'
      newAudit.push(audit('收件批次', action, operator, `${receipt.result}｜${receipt.url}｜${receipt.note}`))
    }
    // 撤回/新版本会推动主张版本号
    for (const claim of result.state.claims) {
      if (events.some((event) => 'claimId' in event && event.claimId === claim.id && (event.type === 'fact-invalidated' || event.type === 'recompute'))) {
        claim.version += 1
        claim.updatedAt = new Date().toISOString()
      }
    }
    const others = state.intakeBatches.filter((item) => item.id !== batch.id)
    set({
      claims: [...result.state.claims],
      sourceRegistry: result.state.registry,
      publishedSnapshots: result.state.snapshots,
      intakeBatches: [batch, ...others],
      audit: [...newAudit, ...state.audit]
    })
    return { ok: true, message: `批次 ${batch.id} 处理完成：${receiptsSummary(batch)}` }
  },
  recoverBatch: (batchId) => {
    const state = get()
    const existing = state.intakeBatches.find((batch) => batch.id === batchId)
    if (!existing) return { ok: false, message: '批次不存在' }
    if (existing.status !== '部分失败') return { ok: false, message: '该批次无需恢复' }
    const input: IntakeBatchInput = { batchId: existing.id, source: existing.source, arrivedAt: existing.arrivedAt, items: existing.items }
    const { result, batch } = processIntakeBatch(chainStateFrom(state), input, existing, true)
    if (!result) {
      const others = state.intakeBatches.filter((item) => item.id !== batch.id)
      set({ intakeBatches: [batch, ...others] })
      return { ok: false, message: batch.error ?? '恢复再次中断' }
    }
    const recovered = result.events.find((event) => event.type === 'recovered')
    const others = state.intakeBatches.filter((item) => item.id !== batch.id)
    set({
      claims: [...result.state.claims],
      sourceRegistry: result.state.registry,
      publishedSnapshots: result.state.snapshots,
      intakeBatches: [batch, ...others],
      audit: recovered ? [audit('收件批次', '批次恢复', '收件链', recovered.detail), ...state.audit] : state.audit
    })
    return { ok: true, message: recovered && recovered.type === 'recovered' ? recovered.detail : '批次已全部完成' }
  },
  transitionClaim: (claimId, status, note) => {
    const state = get()
    const claim = state.claims.find((item) => item.id === claimId)
    if (!claim) return { ok: false, message: '主张不存在' }
    if (status === '待编辑复核' && claim.facts.length === 0) return { ok: false, message: '至少需要一项可验证事实' }
    if (status === '已发布') {
      if (claim.facts.some((fact) => fact.conclusion === '证据不足' && fact.unresolved.length)) return { ok: false, message: '仍有未解决疑点，不能发布' }
      if (!claim.editor) return { ok: false, message: '缺少编辑复核人' }
      const blocking = publishGate(claim)
      if (blocking.length) return { ok: false, message: `发布前收件链校验未通过：${blocking.join('；')}` }
    }
    claim.status = status
    claim.version += 1
    claim.updatedAt = new Date().toISOString()
    const version: VersionRecord = { id: nextId('V'), claimId, version: claim.version, editor: claim.editor || '当前用户', summary: note, changedFactIds: [], removedEvidence: [], createdAt: claim.updatedAt }
    let snapshots = state.publishedSnapshots
    if (status === '已发布') {
      snapshots = [makeSnapshot(claim, claim.editor, note), ...snapshots]
    }
    set((current) => ({
      claims: [...current.claims],
      versions: [version, ...current.versions],
      publishedSnapshots: snapshots,
      audit: [audit(claimId, `状态流转：${status}`, '当前用户', status === '已发布' ? `${note}；发布快照已锁定，来源撤回不影响快照可追` : note), ...current.audit]
    }))
    return { ok: true, message: `已流转至${status}` }
  },
  reset: () => {
    const seeded = migrateSeed()
    set({
      claims: seeded.claims,
      versions: structuredClone(seedVersions),
      audit: structuredClone(seedAudit),
      sourceRegistry: seeded.registry,
      intakeBatches: [],
      publishedSnapshots: [],
      keyword: '',
      status: '全部'
    })
  }
}), { name: 'gsb68:fact-check-workbench-v2' }))

function receiptsSummary(batch: IntakeBatch): string {
  const counts = new Map<string, number>()
  for (const receipt of batch.receipts) counts.set(receipt.result, (counts.get(receipt.result) ?? 0) + 1)
  return [...counts.entries()].map(([result, count]) => `${result}×${count}`).join('，')
}

export const conclusionColor: Record<FactConclusion, string> = {
  已证实: 'green',
  部分属实: 'yellow',
  证据不足: 'orange',
  不实: 'red'
}
