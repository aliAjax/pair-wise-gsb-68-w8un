import type {
  AuditEntry,
  Claim,
  ClaimFact,
  ClaimAnnotation,
  FactSourceRef,
  IngestItemInput,
  IntakeBatch,
  IntakeItem,
  PublishSnapshot,
  SourceState,
  SourceVersion,
} from '../types'

/** 公开地址归一：去锚点、去末尾斜杠、去协议大小写差异，作为版本归并键 */
export function normalizeUrl(url: string): string {
  const trimmed = (url || '').trim()
  if (!trimmed) return ''
  try {
    const u = new URL(trimmed)
    u.hash = ''
    const path = u.pathname.replace(/\/+$/, '') || '/'
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? ':' + u.port : ''}${path}${u.search}`
  } catch {
    return trimmed.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
  }
}

export function hashKey(hash: string | undefined | null): string {
  return (hash || '').trim().replace(/\s+/g, '').toLowerCase()
}

export function findVersion(registry: SourceVersion[], urlKey: string, hash: string): SourceVersion | undefined {
  const h = hashKey(hash)
  return registry.find((item) => item.urlKey === urlKey && hashKey(item.contentHash) === h)
}

export function versionsOf(registry: SourceVersion[], urlKey: string): SourceVersion[] {
  return registry
    .filter((item) => item.urlKey === urlKey)
    .sort((a, b) => b.versionNo - a.versionNo)
}

export function resolveRef(registry: SourceVersion[], ref: FactSourceRef): SourceVersion | undefined {
  if (ref.sourceId) return registry.find((item) => item.id === ref.sourceId)
  if (ref.urlKey) return versionsOf(registry, ref.urlKey)[0]
  return undefined
}

export function allRefs(fact: ClaimFact): FactSourceRef[] {
  return [...fact.sources, ...fact.counterSources]
}

/** 引用只按地址、未钉哈希，且该地址存在多个版本 → 事实引用版本不确定 */
export function refIsAmbiguous(registry: SourceVersion[], ref: FactSourceRef): boolean {
  if (ref.pinned || ref.sourceId) return false
  if (!ref.urlKey) return true
  const live = versionsOf(registry, ref.urlKey).filter((item) => item.state !== '已撤回')
  return live.length > 1
}

export function factHasAmbiguousRef(registry: SourceVersion[], fact: ClaimFact): boolean {
  return allRefs(fact).some((ref) => refIsAmbiguous(registry, ref))
}

export function factRefsVersion(fact: ClaimFact, sourceId: string): FactSourceRef[] {
  return allRefs(fact).filter((ref) => ref.sourceId === sourceId)
}

interface EngineContext {
  nextId: (prefix: string) => string
  now: () => string
}

export interface BatchIngestResult {
  registry: SourceVersion[]
  claims: Claim[]
  items: IntakeItem[]
  audit: AuditEntry[]
}

const terminalStatus = new Set(['已完成', '已去重', '待核', '已撤回生效', '已失效重算', '撤回未匹配'])

/**
 * 处理一个完整收件批次。幂等：终态条目直接保留，恢复批次时只补未完成项。
 * 批次本身（含全部条目原始载荷）始终持久化，写入失败后可完整重放。
 * @param deferred 本批次处理中被存储层拒绝、跳过留待恢复的条目（如模拟写入失败）
 */
export function ingestBatch(
  registry: SourceVersion[],
  claims: Claim[],
  batch: IntakeBatch,
  ctx: EngineContext,
  deferred?: Set<string>,
): BatchIngestResult {
  let nextRegistry = registry.map((item) => ({ ...item }))
  let nextClaims = claims.map((claim) => structuredClone(claim))
  const audit: AuditEntry[] = []
  const items = batch.items.map((original) => {
    const item: IntakeItem = { ...original, attempts: original.attempts + (terminalStatus.has(original.status) || deferred?.has(original.itemId) ? 0 : 1) }
    if (terminalStatus.has(original.status) || deferred?.has(item.itemId)) return item

    const input = itemToInput(item)
    try {
      const outcome = item.kind === '撤回件'
        ? applyRetraction(nextRegistry, nextClaims, input, ctx)
        : applyDelivery(nextRegistry, nextClaims, input, ctx)
      nextRegistry = outcome.registry
      nextClaims = outcome.claims
      audit.push(...outcome.audit)
      item.status = outcome.status
      item.sourceId = outcome.sourceId
      item.versionNo = outcome.versionNo
      item.resultNote = outcome.note
    } catch (error) {
      // 单项写入失败不污染整体：批次保留，恢复时只补这一项
      item.status = '写入失败'
      item.resultNote = error instanceof Error ? error.message : String(error)
      audit.push(auditEntry(ctx, '', '批次写入失败', '系统', `${batch.batchId}/${item.itemId}：${item.resultNote}`))
    }
    return item
  })

  return { registry: nextRegistry, claims: nextClaims, items, audit }
}

function itemToInput(item: IntakeItem): IngestItemInput {
  return {
    kind: item.kind,
    url: item.url,
    title: item.title,
    publisher: item.publisher,
    publishedAt: item.publishedAt,
    contentHash: item.contentHash,
    evidenceKind: item.evidenceKind,
    chainOfCustody: item.chainOfCustody,
    claimId: item.claimId,
    factId: item.factId,
    submitter: item.submitter,
  }
}

interface ApplyOutcome {
  registry: SourceVersion[]
  claims: Claim[]
  status: IntakeItem['status']
  sourceId?: string
  versionNo?: number
  note: string
  audit: AuditEntry[]
}

/** 人工/回调送达一篇报道：同哈希只留一条（后到者只留比对值）；不同哈希保留两版 */
export function applyDelivery(
  registry: SourceVersion[],
  claims: Claim[],
  input: IngestItemInput,
  ctx: EngineContext,
): ApplyOutcome {
  const urlKey = normalizeUrl(input.url)
  if (!urlKey) throw new Error('缺少公开地址，无法登记')
  const receivedAt = ctx.now()
  const audit: AuditEntry[] = []

  // 旧来源/旧回调缺哈希：先待核，不能直接参与发布
  if (!hashKey(input.contentHash)) {
    const pending: SourceVersion = {
      id: ctx.nextId('SV'),
      urlKey,
      title: input.title || urlKey,
      url: input.url.trim(),
      publisher: input.publisher || '来源待核',
      publishedAt: input.publishedAt || '',
      capturedAt: receivedAt,
      kind: input.evidenceKind || '待证信息',
      chainOfCustody: input.chainOfCustody || '收件缺少内容哈希，待核后留档',
      contentHash: '',
      state: '待核',
      versionNo: versionsOf(registry, urlKey).length + 1,
      receivedAt,
      origin: '收件',
    }
    attachRefIfRequested([...registry, pending], claims, pending, input, ctx, receivedAt, audit)
    audit.unshift(auditEntry(ctx, input.claimId || '', '收件待核（缺哈希）', input.submitter || '舆情回调', `${pending.title} · ${urlKey}`))
    return { registry: [...registry, pending], claims, status: '待核', sourceId: pending.id, versionNo: pending.versionNo, note: '缺内容哈希，已置待核，不参与发布', audit }
  }

  const existing = findVersion(registry, urlKey, input.contentHash || '')
  if (existing) {
    // 同哈希重复送达（含两名核查员并发提交同一版本）：不建卡，只留比对值
    const submitter = input.submitter || '舆情回调'
    const note = `与 ${existing.id} V${existing.versionNo} 哈希一致（${existing.contentHash}），仅留存比对值，不重复建卡`
    if (existing.state === '已撤回') {
      audit.push(auditEntry(ctx, input.claimId || '', '撤回版本重复送达', submitter, `${input.title} · ${note}`))
      return { registry, claims, status: '已去重', sourceId: existing.id, versionNo: existing.versionNo, note: `该哈希对应版本已撤回，${note}`, audit }
    }
    audit.push(auditEntry(ctx, input.claimId || '', '同哈希去重', submitter, `${input.title} · ${note}`))
    return { registry, claims, status: '已去重', sourceId: existing.id, versionNo: existing.versionNo, note, audit }
  }

  // 公开地址相同、内容哈希变了：保留两版
  const siblings = versionsOf(registry, urlKey)
  const source: SourceVersion = {
    id: ctx.nextId('SV'),
    urlKey,
    title: input.title || urlKey,
    url: input.url.trim(),
    publisher: input.publisher || (siblings[0]?.publisher ?? ''),
    publishedAt: input.publishedAt || siblings[0]?.publishedAt || '',
    capturedAt: receivedAt,
    kind: input.evidenceKind || siblings[0]?.kind || '待证信息',
    chainOfCustody: input.chainOfCustody || '回调新版本，页面快照与正文哈希同时留档',
    contentHash: input.contentHash!.trim(),
    state: '已核验',
    versionNo: siblings.length + 1,
    receivedAt,
    origin: '收件',
  }
  const nextRegistry = [...registry, source]

  // 该地址已有旧版：只按地址引用、未钉哈希的事实标记为版本不确定
  if (siblings.length) {
    markAmbiguousFacts(claims, urlKey, source, ctx, audit)
  }
  attachRefIfRequested(nextRegistry, claims, source, input, ctx, receivedAt, audit)
  audit.unshift(auditEntry(ctx, input.claimId || '', siblings.length ? '来源新版本收件' : '新来源收件', input.submitter || '舆情回调', `${source.title} V${source.versionNo} · ${source.contentHash}${siblings.length ? `（与 V${siblings[0].versionNo} 并存）` : ''}`))
  return { registry: nextRegistry, claims, status: '已完成', sourceId: source.id, versionNo: source.versionNo, note: siblings.length ? `同址哈希变化，已保留为 V${source.versionNo}，未钉版引用标记为版本不确定` : '已登记并核验哈希', audit }
}

/** 撤回件到达：依赖该版的未发布结论失效重算；已发布主张不动，快照仍可追 */
export function applyRetraction(
  registry: SourceVersion[],
  claims: Claim[],
  input: IngestItemInput,
  ctx: EngineContext,
): ApplyOutcome {
  const urlKey = normalizeUrl(input.url)
  const h = hashKey(input.contentHash)
  const audit: AuditEntry[] = []
  if (!urlKey) throw new Error('撤回件缺少公开地址')

  // 精确命中哈希版本；无哈希时只在该地址仅有一个版本时命中
  let target = h ? findVersion(registry, urlKey, input.contentHash || '') : undefined
  if (!target) {
    const siblings = versionsOf(registry, urlKey)
    if (!h && siblings.length === 1) target = siblings[0]
  }
  if (!target) {
    audit.push(auditEntry(ctx, input.claimId || '', '撤回未匹配', input.submitter || '舆情回调', `${input.title} · ${urlKey}${h ? ' · ' + input.contentHash : '（撤回件无哈希）'}`))
    return { registry, claims, status: '撤回未匹配', note: '未找到对应内容版本，撤回件挂起待人工核对', audit }
  }
  if (target.state === '已撤回') {
    return { registry, claims, status: '已去重', sourceId: target.id, versionNo: target.versionNo, note: '重复撤回，原撤回记录仍有效', audit }
  }

  const retracted: SourceVersion = { ...target, state: '已撤回' as SourceState, retractedAt: ctx.now() }
  const nextRegistry = registry.map((item) => (item.id === target!.id ? retracted : item))

  let invalidated = 0
  for (const claim of claims) {
    if (claim.status === '已发布') continue // 已发布快照冻结
    let claimInvalidated = 0
    for (const fact of claim.facts) {
      const depending = factRefsVersion(fact, retracted.id)
      if (!depending.length) continue
      invalidateFact(fact, retracted, depending, ctx)
      invalidated += 1
      claimInvalidated += 1
    }
    if (claimInvalidated && claim.status === '待编辑复核') claim.status = '核查中'
  }

  audit.unshift(auditEntry(ctx, input.claimId || '', '来源版本撤回', input.submitter || '舆情回调', `${retracted.title} V${retracted.versionNo} · ${retracted.contentHash}；${invalidated ? `未发布依赖结论失效重算 ${invalidated} 项，已发布快照不受影响` : '无未发布依赖'}`))
  return {
    registry: nextRegistry,
    claims,
    status: invalidated ? '已失效重算' : '已撤回生效',
    sourceId: retracted.id,
    versionNo: retracted.versionNo,
    note: invalidated ? `已撤回，${invalidated} 项未发布结论失效待重算；已发布快照仍可追溯` : '版本已撤回，无待重算结论',
    audit,
  }
}

function markAmbiguousFacts(claims: Claim[], urlKey: string, source: SourceVersion, ctx: EngineContext, audit: AuditEntry[]) {
  for (const claim of claims) {
    for (const fact of claim.facts) {
      const loose = allRefs(fact).filter((ref) => !ref.pinned && !ref.sourceId && ref.urlKey === urlKey)
      if (!loose.length) continue
      const note = claim.status === '已发布'
        ? `来源出现 V${source.versionNo} 新版本，已发布结论引用的版本冻结在发布快照中`
        : `来源公开地址 ${urlKey} 出现 V${source.versionNo} 新版本，该事实仅按地址引用、未钉哈希，引用版本不确定，发布前必须钉版`
      // 已发布主张冻结，不再往事实上写批注，只在审计留痕
      if (claim.status !== '已发布') fact.annotations.unshift(systemAnnotation(ctx, note))
      audit.push(auditEntry(ctx, claim.id, '事实引用版本不确定', '系统', `${fact.id}：${note}`))
    }
  }
}

function invalidateFact(fact: ClaimFact, source: SourceVersion, refs: FactSourceRef[], ctx: EngineContext) {
  const annotation = systemAnnotation(ctx, `依赖的来源版本「${source.title} V${source.versionNo}」已撤回，原结论“${fact.conclusion}（${fact.confidence}%）”失效，须重算后才能再发布`)
  fact.annotations.unshift(annotation)
  const hadRecompute = fact.recompute?.required
  fact.recompute = {
    required: true,
    reason: `来源版本 V${source.versionNo}（${source.contentHash}）被撤回`,
    at: ctx.now(),
    sourceId: source.id,
    annotationIds: [...(hadRecompute ? fact.recompute!.annotationIds : []), annotation.id],
    prevConclusion: hadRecompute ? fact.recompute!.prevConclusion ?? fact.conclusion : fact.conclusion,
    prevConfidence: hadRecompute ? fact.recompute!.prevConfidence ?? fact.confidence : fact.confidence,
  }
}

function systemAnnotation(ctx: EngineContext, content: string): ClaimAnnotation {
  return { id: ctx.nextId('N'), author: '收件链', role: '系统', content, createdAt: ctx.now(), resolved: false }
}

function attachRefIfRequested(
  registry: SourceVersion[],
  claims: Claim[],
  source: SourceVersion,
  input: IngestItemInput,
  ctx: EngineContext,
  at: string,
  audit: AuditEntry[],
) {
  if (!input.claimId || !input.factId) return
  const claim = claims.find((item) => item.id === input.claimId)
  const fact = claim?.facts.find((item) => item.id === input.factId)
  if (!claim || !fact) return
  const list = input.counter ? fact.counterSources : fact.sources
  const already = list.some((ref) => ref.sourceId === source.id)
  if (already) return
  const verified = Boolean(hashKey(source.contentHash))
  // 带哈希的回调钉住该版；缺哈希的待核件也挂引用，但标记为未钉版，发布校验会拦截
  list.push({
    refId: ctx.nextId('R'),
    counter: Boolean(input.counter),
    pinned: verified,
    sourceId: source.id,
    urlKey: source.urlKey,
    hash: verified ? source.contentHash : undefined,
    since: at,
  })
  if (verified) {
    audit.push(auditEntry(ctx, claim.id, input.origin === '人工' ? '人工钉住来源版本' : '回调钉住来源版本', input.submitter || (input.origin === '人工' ? '当前核查员' : '舆情回调'), `${fact.id} → ${source.title} V${source.versionNo}（${source.contentHash}）`))
  } else {
    audit.push(auditEntry(ctx, claim.id, '关联待核来源', input.submitter || '舆情回调', `${fact.id} → ${source.title} V${source.versionNo}（缺哈希，补核前不得发布）`))
  }
}

function auditEntry(ctx: EngineContext, claimId: string, action: string, operator: string, detail: string): AuditEntry {
  return { id: ctx.nextId('AUD'), claimId, action, operator, detail, createdAt: ctx.now() }
}

export interface PreflightResult {
  allowed: boolean
  blocking: string[]
  warnings: string[]
}

/** 发布前校验：待核/撤回/断链/版本不确定/待重算 全部阻断 */
export function preflightPublish(registry: SourceVersion[], claim: Claim): PreflightResult {
  const blocking: string[] = []
  const warnings: string[] = []
  for (const fact of claim.facts) {
    if (fact.recompute?.required) blocking.push(`事实「${fact.text}」依赖版本已撤回，结论失效待重算`)
    if (fact.conclusion === '证据不足' && fact.unresolved.length) blocking.push(`事实「${fact.text}」仍证据不足且有未解决疑点`)
    if (allRefs(fact).length === 0) blocking.push(`事实「${fact.text}」没有任何来源引用`)
    for (const ref of allRefs(fact)) {
      const source = resolveRef(registry, ref)
      if (!source) {
        blocking.push(`事实「${fact.text}」存在来源台账中找不到的断链引用`)
        continue
      }
      if (source.state === '待核') blocking.push(`事实「${fact.text}」引用的「${source.title}」缺少内容哈希、仍待核`)
      if (source.state === '已撤回') blocking.push(`事实「${fact.text}」引用的「${source.title} V${source.versionNo}」已撤回`)
      if (refIsAmbiguous(registry, ref)) blocking.push(`事实「${fact.text}」对「${source.title}」仅按地址引用且存在多版本，须钉住确定版本`)
      if (!ref.pinned && versionsOf(registry, source.urlKey).filter((item) => item.state !== '已撤回').length === 1) {
        warnings.push(`事实「${fact.text}」对「${source.title}」尚未钉版（当前仅一版）`)
      }
    }
  }
  if (!claim.editor) blocking.push('缺少编辑复核人')
  return { allowed: blocking.length === 0, blocking, warnings }
}

/** 发布瞬间冻结快照：引用必须已钉版，快照冗余标题/哈希/状态，之后可独立追溯 */
export function buildPublishSnapshot(registry: SourceVersion[], claim: Claim, editor: string, note: string, snapshotId: string, at: string): PublishSnapshot {
  const sourceCopies: SourceVersion[] = []
  const seen = new Set<string>()
  const factDigests = claim.facts.map((fact) => {
    const refs = allRefs(fact).map((ref) => {
      const source = resolveRef(registry, ref)!
      if (!seen.has(source.id)) {
        seen.add(source.id)
        sourceCopies.push(structuredClone(source))
      }
      return {
        counter: ref.counter,
        sourceId: source.id,
        title: source.title,
        url: source.url,
        hash: source.contentHash,
        state: source.state,
      }
    })
    return { factId: fact.id, text: fact.text, conclusion: fact.conclusion, confidence: fact.confidence, refs }
  })
  return {
    id: snapshotId,
    claimId: claim.id,
    claimVersion: claim.version,
    title: claim.title,
    publishedAt: at,
    editor,
    note,
    claimCopy: structuredClone(claim),
    sourceCopies,
    factDigests,
  }
}

export const batchIsRecoverable = (batch: IntakeBatch): boolean =>
  batch.items.some((item) => item.status === '写入失败' || item.status === '待处理')
