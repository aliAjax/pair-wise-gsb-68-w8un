import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedAudit, seedBatches, seedClaims, seedRegistry, seedSnapshots, seedVersions } from '../data/seed'
import {
  applyDelivery,
  batchIsRecoverable,
  buildPublishSnapshot,
  hashKey,
  ingestBatch,
  normalizeUrl,
  preflightPublish,
  versionsOf,
} from '../services/chains'
import type {
  AuditEntry,
  Claim,
  ClaimAnnotation,
  ClaimFact,
  FactConclusion,
  IngestItemInput,
  IntakeBatch,
  IntakeItem,
  PublishSnapshot,
  SourceVersion,
  VersionRecord,
} from '../types'

interface ClaimState {
  claims: Claim[]
  versions: VersionRecord[]
  audit: AuditEntry[]
  registry: SourceVersion[]
  batches: IntakeBatch[]
  snapshots: PublishSnapshot[]
  keyword: string
  status: Claim['status'] | '全部'
  setKeyword: (value: string) => void
  setStatus: (value: Claim['status'] | '全部') => void
  addClaim: (input: { title: string; summary: string; reporter: string; priority: Claim['priority'] }) => Claim
  updateFact: (claimId: string, factId: string, patch: Partial<ClaimFact>) => void
  addFact: (claimId: string, text: string) => void
  addAnnotation: (claimId: string, factId: string, annotation: Omit<ClaimAnnotation, 'id' | 'createdAt' | 'resolved'>) => void
  resolveAnnotation: (claimId: string, factId: string, annotationId: string) => void
  /** 核查员人工提交来源版本；同哈希只留比对值，不同哈希保留新版 */
  submitSource: (claimId: string, factId: string, source: { title: string; url: string; publisher: string; publishedAt: string; kind: SourceVersion['kind']; chainOfCustody: string; contentHash: string }, counter: boolean) => { ok: boolean; message: string }
  /** 把仅按地址的引用钉到确定版本 */
  pinRef: (claimId: string, factId: string, refId: string, sourceId: string) => void
  /** 旧来源/待核件补算哈希后核验 */
  verifySourceHash: (sourceId: string, hash: string) => { ok: boolean; message: string }
  /** 撤回件到达后失效的事实，重算结论并关闭重算要求 */
  resolveRecompute: (claimId: string, factId: string, conclusion: FactConclusion, confidence: number, note: string) => void
  /** 撤回一个来源版本（手工入口，等价于撤回通道回调） */
  retractSource: (sourceId: string, reason: string) => void
  /** 接收入一批舆情回调；可选 failIndex 模拟第 N 项写入失败 */
  ingestChannelBatch: (channel: string, inputs: IngestItemInput[], failIndex?: number) => void
  /** 从完整收件批次恢复，只补未完成（写入失败/待处理）项 */
  recoverBatch: (batchId: string) => { ok: boolean; message: string }
  transitionClaim: (claimId: string, status: Claim['status'], note: string) => { ok: boolean; message: string }
  reset: () => void
}

let idSeed = 100
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${idSeed++}`
const nowIso = () => new Date().toISOString()
const engineCtx = () => ({ nextId, now: nowIso })

function appendAudit(entries: AuditEntry[], entry: AuditEntry): AuditEntry[] {
  return [entry, ...entries]
}

export const useClaimStore = create<ClaimState>()(persist((set, get) => ({
  claims: seedClaims,
  versions: seedVersions,
  audit: seedAudit,
  registry: seedRegistry,
  batches: seedBatches,
  snapshots: seedSnapshots,
  keyword: '',
  status: '全部',
  setKeyword: (keyword) => set({ keyword }),
  setStatus: (status) => set({ status }),

  addClaim: (input) => {
    const now = nowIso()
    const claim: Claim = { id: nextId('FC'), ...input, editor: '宋卓', status: '核查中', createdAt: now, updatedAt: now, version: 1, facts: [] }
    set((state) => ({ claims: [claim, ...state.claims], audit: appendAudit(state.audit, { id: nextId('AUD'), claimId: claim.id, action: '建立核查主张', operator: input.reporter, detail: input.summary, createdAt: now }) }))
    return claim
  },

  addFact: (claimId, text) => set((state) => {
    const claims = structuredClone(state.claims)
    const claim = claims.find((item) => item.id === claimId)
    if (!claim || !text.trim()) return {}
    const now = nowIso()
    claim.facts.push({ id: nextId('F'), text, conclusion: '证据不足', confidence: 30, unresolved: ['尚未关联来源'], sources: [], counterSources: [], annotations: [] })
    claim.version += 1
    claim.updatedAt = now
    return { claims, audit: appendAudit(state.audit, { id: nextId('AUD'), claimId, action: '拆分可验证事实', operator: claim.reporter, detail: text, createdAt: now }) }
  }),

  updateFact: (claimId, factId, patch) => set((state) => {
    const claims = structuredClone(state.claims)
    const claim = claims.find((item) => item.id === claimId)
    const fact = claim?.facts.find((item) => item.id === factId)
    if (!claim || !fact) return {}
    if (fact.recompute?.required && (patch.conclusion || patch.confidence !== undefined)) {
      return {} // 待重算结论必须通过 resolveRecompute 完成
    }
    if (patch.conclusion && patch.conclusion !== '证据不足' && fact.unresolved.length) {
      patch.confidence = Math.min(patch.confidence ?? fact.confidence, 75)
    }
    Object.assign(fact, patch)
    claim.version += 1
    claim.updatedAt = nowIso()
    return { claims, audit: appendAudit(state.audit, { id: nextId('AUD'), claimId, action: '更新事实结论', operator: '当前用户', detail: `${fact.text}：${fact.conclusion}`, createdAt: nowIso() }) }
  }),

  addAnnotation: (claimId, factId, input) => set((state) => {
    const claims = structuredClone(state.claims)
    const fact = claims.find((item) => item.id === claimId)?.facts.find((item) => item.id === factId)
    if (!fact) return {}
    const now = nowIso()
    fact.annotations.unshift({ ...input, id: nextId('N'), createdAt: now, resolved: false })
    return { claims, audit: appendAudit(state.audit, { id: nextId('AUD'), claimId, action: '添加批注', operator: input.author, detail: input.content, createdAt: now }) }
  }),

  resolveAnnotation: (claimId, factId, annotationId) => set((state) => {
    const claims = structuredClone(state.claims)
    const fact = claims.find((item) => item.id === claimId)?.facts.find((item) => item.id === factId)
    const annotation = fact?.annotations.find((item) => item.id === annotationId)
    if (!fact || !annotation) return {}
    annotation.resolved = true
    return { claims, audit: appendAudit(state.audit, { id: nextId('AUD'), claimId, action: '解决批注', operator: '当前用户', detail: annotation.content, createdAt: nowIso() }) }
  }),

  submitSource: (claimId, factId, source, counter) => {
    // 两名核查员同时提交同一来源版本（同址同哈希）：后到者只留比对值，不新建卡片
    const state = get()
    const claims = structuredClone(state.claims)
    const result = applyDelivery(state.registry, claims, {
      kind: '回调送达',
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      publishedAt: source.publishedAt,
      contentHash: source.contentHash,
      evidenceKind: source.kind,
      chainOfCustody: source.chainOfCustody,
      claimId,
      factId,
      counter,
      origin: '人工',
      submitter: '陆衡（事实核查员）',
    }, engineCtx())
    const target = claims.find((item) => item.id === claimId)
    target && (target.version += 1, target.updatedAt = nowIso())
    set({ registry: result.registry, claims, audit: [...result.audit, ...state.audit] })
    return { ok: result.status !== '写入失败', message: result.note }
  },

  pinRef: (claimId, factId, refId, sourceId) => set((state) => {
    const claims = structuredClone(state.claims)
    const fact = claims.find((item) => item.id === claimId)?.facts.find((item) => item.id === factId)
    const target = state.registry.find((item) => item.id === sourceId)
    if (!fact || !target) return {}
    const ref = [...fact.sources, ...fact.counterSources].find((item) => item.refId === refId)
    if (!ref) return {}
    ref.pinned = true
    ref.sourceId = target.id
    ref.urlKey = target.urlKey
    ref.hash = target.contentHash
    // 钉版后关闭“版本不确定”系统批注
    fact.annotations = fact.annotations.map((note) =>
      note.role === '系统' && note.content.includes('版本不确定') && !note.resolved ? { ...note, resolved: true } : note)
    const now = nowIso()
    const claim = claims.find((item) => item.id === claimId)!
    claim.updatedAt = now
    return { claims, audit: appendAudit(state.audit, { id: nextId('AUD'), claimId, action: '钉住来源版本', operator: '当前用户', detail: `${fact.text} → ${target.title} V${target.versionNo}（${target.contentHash}）`, createdAt: now }) }
  }),

  verifySourceHash: (sourceId, hash) => {
    const state = get()
    const target = state.registry.find((item) => item.id === sourceId)
    if (!target) return { ok: false, message: '来源不在台账中' }
    if (target.state !== '待核') return { ok: false, message: '该版本已核验或已撤回' }
    if (!hashKey(hash)) return { ok: false, message: '内容哈希不能为空' }
    const duplicate = state.registry.some((item) => item.id !== sourceId && item.urlKey === target.urlKey && hashKey(item.contentHash) === hashKey(hash))
    if (duplicate) {
      // 补算出的哈希与既有版本相同：该待核卡就是重复件，只留比对值，台账卡转为已去重占位说明
      const now = nowIso()
      const audit = appendAudit(state.audit, { id: nextId('AUD'), claimId: '', action: '待核件哈希比对一致', operator: '当前用户', detail: `${target.title} 补算哈希与既有版本一致，仅留比对值`, createdAt: now })
      return { ok: false, message: '补算哈希与该地址既有版本一致：该件为重复件，只保留比对值，不另立版本' }
    }
    const registry = state.registry.map((item) => item.id === sourceId ? { ...item, contentHash: hash.trim(), state: '已核验' as const, chainOfCustody: `${item.chainOfCustody}；${nowIso()} 补算哈希完成并核验` } : item)
    // 补齐此前未钉版的引用
    const claims = structuredClone(state.claims)
    for (const claim of claims) {
      for (const fact of claim.facts) {
        for (const ref of [...fact.sources, ...fact.counterSources]) {
          if (ref.sourceId === sourceId) { ref.pinned = true; ref.hash = hash.trim() }
        }
      }
    }
    const now = nowIso()
    set({ registry, claims, audit: appendAudit(state.audit, { id: nextId('AUD'), claimId: '', action: '待核件补哈希核验', operator: '当前用户', detail: `${target.title} V${target.versionNo}（${hash.trim()}）`, createdAt: now }) })
    return { ok: true, message: '哈希已补算并核验，引用自动钉版，可参与发布' }
  },

  resolveRecompute: (claimId, factId, conclusion, confidence, note) => set((state) => {
    const claims = structuredClone(state.claims)
    const claim = claims.find((item) => item.id === claimId)
    const fact = claim?.facts.find((item) => item.id === factId)
    if (!claim || !fact || !fact.recompute?.required) return {}
    const now = nowIso()
    fact.conclusion = conclusion
    fact.confidence = confidence
    fact.annotations = fact.annotations.map((item) => fact.recompute!.annotationIds.includes(item.id) ? { ...item, resolved: true } : item)
    fact.recompute = { ...fact.recompute, required: false, resolvedAt: now }
    claim.version += 1
    claim.updatedAt = now
    return { claims, versions: [{ id: nextId('V'), claimId, version: claim.version, editor: claim.editor || '当前用户', summary: `撤回后重算：${fact.text} → ${conclusion}。${note}`, changedFactIds: [factId], removedEvidence: [], createdAt: now }, ...state.versions], audit: appendAudit(state.audit, { id: nextId('AUD'), claimId, action: '失效结论重算完成', operator: '当前用户', detail: `${fact.text}：${conclusion}（${confidence}%）${note ? '；' + note : ''}`, createdAt: now }) }
  }),

  retractSource: (sourceId, reason) => {
    const state = get()
    const target = state.registry.find((item) => item.id === sourceId)
    if (!target) return
    const batch = makeBatch('舆情回调 / 撤回通道', [{ kind: '撤回件', url: target.url, title: target.title, publisher: target.publisher, publishedAt: target.publishedAt, contentHash: target.contentHash, evidenceKind: target.kind, chainOfCustody: reason, submitter: '撤回通道' }])
    runBatch(set, get, batch)
  },

  ingestChannelBatch: (channel, inputs, failIndex) => {
    const stored = makeBatch(channel, inputs)
    if (failIndex !== undefined && stored.items[failIndex]) {
      // 第一阶段：第 N 项模拟存储写入失败，完整批次先持久化（含全部原始载荷），不结清
      const failed = stored.items[failIndex]
      failed.status = '写入失败'
      failed.attempts = 1
      failed.resultNote = '模拟存储写入失败：批次条目保留，恢复时只补本项'
      stored.complete = false
      set((state) => ({
        batches: [structuredClone(stored), ...state.batches],
        audit: [{ id: nextId('AUD'), claimId: '', action: '批次写入失败', operator: '系统', detail: `${stored.batchId}/${failed.itemId}：存储超时，批次已留存待恢复`, createdAt: nowIso() }, ...state.audit],
      }))
      // 第二阶段：处理其余条目；失败项本批跳过，恢复时只补它；终态项不重复处理
      runBatch(set, get, stored, true, new Set([failed.itemId]))
      return
    }
    runBatch(set, get, stored)
  },

  recoverBatch: (batchId) => {
    const state = get()
    const batch = state.batches.find((item) => item.batchId === batchId)
    if (!batch) return { ok: false, message: '批次不存在' }
    if (!batchIsRecoverable(batch)) return { ok: false, message: '该批次没有未完成项' }
    // 以完整批次重放：终态项原样保留，只补写入失败/待处理项
    const replay = structuredClone(batch)
    const recoveredIds = replay.items.filter((item) => ['写入失败', '待处理'].includes(item.status)).map((item) => item.itemId)
    const result = ingestBatch(state.registry, state.claims, replay, engineCtx())
    const complete = result.items.every((item) => !['写入失败', '待处理'].includes(item.status))
    const merged: IntakeBatch = { ...replay, items: result.items, complete, appliedAt: complete ? nowIso() : replay.appliedAt }
    set({
      registry: result.registry,
      claims: result.claims,
      batches: state.batches.map((item) => item.batchId === batchId ? merged : item),
      audit: [...result.audit, ...state.audit, { id: nextId('AUD'), claimId: '', action: '收件批次恢复', operator: '系统', detail: `${batchId} 从完整批次重放，仅补未完成项：${recoveredIds.join('、') || '无'}`, createdAt: nowIso() }],
    })
    return complete
      ? { ok: true, message: `批次恢复完成，补做 ${recoveredIds.length} 项（${recoveredIds.join('、')}），终态项未重复处理` }
      : { ok: false, message: '仍有条目写入失败，可再次恢复' }
  },

  transitionClaim: (claimId, status, note) => {
    const state = get()
    const claims = structuredClone(state.claims)
    const claim = claims.find((item) => item.id === claimId)
    if (!claim) return { ok: false, message: '主张不存在' }
    if (status === '待编辑复核' && claim.facts.length === 0) return { ok: false, message: '至少需要一项可验证事实' }
    if (status === '已发布') {
      const preflight = preflightPublish(state.registry, claim)
      if (!preflight.allowed) return { ok: false, message: `发布前校验未通过：${preflight.blocking.join('；')}` }
    }
    const now = nowIso()
    claim.status = status
    claim.version += 1
    claim.updatedAt = now
    let snapshots = state.snapshots
    if (status === '已发布') {
      // 发布瞬间冻结：主张副本 + 引用来源副本（标题/哈希/状态），之后撤回也不改快照
      const snapshot = buildPublishSnapshot(state.registry, claim, claim.editor || '当前用户', note, nextId('SNAP'), now)
      snapshots = [snapshot, ...snapshots]
    }
    const version: VersionRecord = { id: nextId('V'), claimId, version: claim.version, editor: claim.editor || '当前用户', summary: note, changedFactIds: [], removedEvidence: [], createdAt: now }
    set((current) => ({
      claims,
      snapshots,
      versions: [version, ...current.versions],
      audit: appendAudit(current.audit, { id: nextId('AUD'), claimId, action: status === '已发布' ? '发布锁定' : `状态流转：${status}`, operator: '当前用户', detail: status === '已发布' ? `${note}；发布快照 ${snapshots[0]?.id ?? ''}` : note, createdAt: now }),
    }))
    return { ok: true, message: status === '已发布' ? `已发布并冻结快照 ${snapshots[0]?.id ?? ''}` : `已流转至${status}` }
  },

  reset: () => set({
    claims: structuredClone(seedClaims),
    versions: structuredClone(seedVersions),
    audit: structuredClone(seedAudit),
    registry: structuredClone(seedRegistry),
    batches: structuredClone(seedBatches),
    snapshots: structuredClone(seedSnapshots),
    keyword: '',
    status: '全部',
  }),
}), {
  name: 'gsb68:fact-chain-v2',
  version: 2,
  migrate: (persisted: unknown) => {
    // v1：来源内嵌在事实卡片里，迁移到全局来源台账并将引用钉为当时版本
    const state = (persisted && typeof persisted === 'object' ? persisted : {}) as Partial<ClaimState>
    const oldClaims = (state.claims ?? []) as Claim[]
    const registry: SourceVersion[] = []
    const claims = structuredClone(oldClaims)
    const flatten = (fact: ClaimFact) => {
      const convert = (source: SourceVersion & { supersededBy?: string }, counter: boolean) => {
        const hasHash = Boolean(hashKey(source.contentHash))
        const record: SourceVersion = {
          id: source.id,
          urlKey: normalizeUrl(source.url),
          title: source.title,
          url: source.url,
          publisher: source.publisher,
          publishedAt: source.publishedAt,
          capturedAt: source.capturedAt,
          kind: source.kind,
          chainOfCustody: source.chainOfCustody,
          contentHash: source.contentHash ?? '',
          state: hasHash ? '已核验' : '待核',
          versionNo: (source as SourceVersion).versionNo || 1,
          receivedAt: source.capturedAt,
          retractedAt: undefined,
          origin: '旧档',
        }
        registry.push(record)
        return { refId: nextId('R'), counter, pinned: hasHash, sourceId: source.id, urlKey: record.urlKey, hash: hasHash ? source.contentHash : undefined, since: source.capturedAt }
      }
      const sources = (fact as unknown as { sources: Array<SourceVersion & { supersededBy?: string }> }).sources?.map((item) => convert(item, false)) ?? fact.sources ?? []
      const counterSources = (fact as unknown as { counterSources: Array<SourceVersion & { supersededBy?: string }> }).counterSources?.map((item) => convert(item, true)) ?? fact.counterSources ?? []
      fact.sources = sources
      fact.counterSources = counterSources
    }
    claims.forEach((claim) => claim.facts.forEach(flatten))
    return { ...state, claims, registry: state.registry ?? registry, batches: state.batches ?? [], snapshots: state.snapshots ?? [] }
  },
}))

function makeBatch(channel: string, inputs: IngestItemInput[]): IntakeBatch {
  const at = nowIso()
  const items: IntakeItem[] = inputs.map((input) => ({
    itemId: nextId('ITM'),
    kind: input.kind,
    title: input.title ?? input.url,
    url: input.url,
    publisher: input.publisher ?? '',
    publishedAt: input.publishedAt ?? '',
    contentHash: input.contentHash ?? '',
    evidenceKind: input.evidenceKind ?? '待证信息',
    chainOfCustody: input.chainOfCustody ?? '',
    receivedAt: at,
    status: '待处理',
    attempts: 0,
    claimId: input.claimId,
    factId: input.factId,
    submitter: input.submitter,
  }))
  return { batchId: nextId('BATCH'), channel, receivedAt: at, complete: false, items }
}

function runBatch(
  set: (partial: Partial<ClaimState> | ((state: ClaimState) => Partial<ClaimState>)) => void,
  get: () => ClaimState,
  batch: IntakeBatch,
  alreadyStored = false,
  deferred?: Set<string>,
) {
  const state = get()
  const result = ingestBatch(state.registry, state.claims, batch, engineCtx(), deferred)
  const complete = result.items.every((item) => !['写入失败', '待处理'].includes(item.status))
  const stored: IntakeBatch = { ...batch, items: result.items, complete, appliedAt: complete ? nowIso() : batch.appliedAt }
  set({
    registry: result.registry,
    claims: result.claims,
    batches: alreadyStored
      ? state.batches.map((item) => item.batchId === stored.batchId ? stored : item)
      : [stored, ...state.batches],
    audit: [...result.audit, ...state.audit],
  })
}

export { preflightPublish, versionsOf }
export const conclusionColor: Record<FactConclusion, string> = {
  已证实: 'green',
  部分属实: 'yellow',
  证据不足: 'orange',
  不实: 'red'
}
