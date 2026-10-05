import type {
  Claim,
  ClaimFact,
  DeliveryReceipt,
  IntakeBatch,
  IntakeBatchInput,
  IntakeItem,
  PublishedSnapshot,
  SourceRecord,
  SourceVersion,
  UncertainRef
} from '../types'

export const sourceKeyOf = (url: string) => `URL:${url.trim()}`

const HASH_PREFIX = /^sha256:/i
export const isHashPending = (hash: string | undefined): boolean => {
  const value = (hash ?? '').trim()
  return value === '' || value === '待核' || value === 'pending'
}
export const normalizeHash = (hash: string) => hash.trim().replace(HASH_PREFIX, 'sha256:')

function nowIso(): string {
  return new Date().toISOString()
}

function findVersion(registry: SourceVersion[], key: string, hash: string): SourceVersion | undefined {
  return registry.find((entry) => entry.key === key && normalizeHash(entry.contentHash) === normalizeHash(hash))
}

function siblingsOf(registry: SourceVersion[], key: string, excludeHash?: string): SourceVersion[] {
  return registry.filter((entry) => entry.key === key && (!excludeHash || normalizeHash(entry.contentHash) !== normalizeHash(excludeHash)))
}

function refreshSiblingHashes(registry: SourceVersion[], key: string): void {
  const family = registry.filter((entry) => entry.key === key)
  for (const entry of family) {
    entry.siblingHashes = family
      .filter((other) => other !== entry && !isHashPending(other.contentHash))
      .map((other) => other.contentHash)
  }
}

/** 事实引用某来源版本的确定哈希；旧来源无 versionRefs 时返回 null（引用不确定版本） */
export function pinnedHashOf(fact: ClaimFact, key: string): string | null {
  return fact.versionRefs?.[key] ?? null
}

export interface ChainState {
  registry: SourceVersion[]
  claims: Claim[]
  snapshots: PublishedSnapshot[]
}

export type ChainEvent =
  | { type: 'delivery'; receipt: DeliveryReceipt }
  | { type: 'fact-uncertain'; claimId: string; factId: string; key: string; hash: string | null; detail: string }
  | { type: 'fact-invalidated'; claimId: string; factId: string; key: string; hash: string; detail: string }
  | { type: 'snapshot-retraction'; claimId: string; snapshotId: string; hashes: string[]; detail: string }
  | { type: 'recompute'; claimId: string; factId: string; detail: string }
  | { type: 'recovered'; batchId: string; itemIds: string[]; detail: string }

export interface ProcessResult {
  state: ChainState
  receipts: DeliveryReceipt[]
  events: ChainEvent[]
}

/**
 * 处理完整收件批次：逐条过收件链，任一写入失败即中断并把批次保留为“部分失败”，
 * 调用方可凭批次内完整 payload 重放——已完成项幂等只补未完成项。
 */
export function processIntakeBatch(
  prev: ChainState,
  input: IntakeBatchInput,
  existing?: IntakeBatch,
  forceComplete = false
): { result?: ProcessResult; batch: IntakeBatch } {
  const priorItemIds = new Set((existing?.receipts ?? []).map((receipt) => receipt.itemId))
  // 恢复场景：先重放已完成项重建状态，但保留原始回执（处理时间与结果不被改写）
  let state: ChainState = cloneState(prev)
  const events: ChainEvent[] = []

  if (existing && priorItemIds.size > 0) {
    for (const item of input.items) {
      if (!priorItemIds.has(item.itemId)) continue
      const applied = applyItem(state, item)
      state = applied.state
      events.push(...applied.events)
    }
  }

  const receipts = existing ? [...existing.receipts] : []
  let processedCount = receipts.length
  for (const item of input.items) {
    if (priorItemIds.has(item.itemId)) continue
    if (item.simulateWriteFailure && !forceComplete) {
      const batch: IntakeBatch = {
        ...(existing ?? { id: input.batchId, source: input.source, arrivedAt: input.arrivedAt, receipts: [] }),
        id: existing?.id ?? input.batchId,
        source: input.source,
        arrivedAt: existing?.arrivedAt ?? input.arrivedAt,
        items: input.items,
        status: '部分失败',
        receipts,
        processedAt: nowIso(),
        error: `写入失败于第 ${processedCount + 1} 项（${item.itemId}）：来源卡片未落盘，完整批次保留待恢复`
      }
      return { batch }
    }
    const applied = applyItem(state, item)
    state = applied.state
    events.push(...applied.events)
    receipts.push(applied.receipt)
    processedCount += 1
  }

  const batch: IntakeBatch = {
    id: existing?.id ?? input.batchId,
    source: input.source,
    arrivedAt: existing?.arrivedAt ?? input.arrivedAt,
    items: input.items,
    status: '已处理',
    receipts,
    processedAt: nowIso()
  }
  if (existing && receipts.length > (existing.receipts?.length ?? 0)) {
    events.push({
      type: 'recovered',
      batchId: batch.id,
      itemIds: receipts.slice(existing.receipts.length).map((receipt) => receipt.itemId),
      detail: `从完整收件批次恢复，仅补写 ${receipts.length - existing.receipts.length} 个未完成项`
    })
  }
  const outcome: ProcessResult = { state, receipts, events }
  return { result: outcome, batch }
}

function applyItem(prev: ChainState, item: IntakeItem): { state: ChainState; receipt: DeliveryReceipt; events: ChainEvent[] } {
  const state: ChainState = { registry: prev.registry.map((entry) => ({ ...entry, verifications: [...entry.verifications], siblingHashes: [...entry.siblingHashes] })), claims: prev.claims, snapshots: prev.snapshots }
  const events: ChainEvent[] = []
  const url = (item.url ?? '').trim()
  const key = sourceKeyOf(url)
  const receivedAt = item.receivedAt
  let result: DeliveryReceipt['result']
  let note = ''
  let hash = ''

  if (item.kind === 'retraction') {
    const targetHash = item.refHash ? normalizeHash(item.refHash) : ''
    const target = targetHash ? findVersion(state.registry, key, targetHash) : state.registry.find((entry) => entry.key === key)
    if (target && !isHashPending(target.contentHash) && target.status !== '已撤回') {
      target.status = '已撤回'
      target.retractedBy = item.itemId
      target.retractedAt = receivedAt
      hash = target.contentHash
      result = 'retracted'
      note = `撤回件到达：${target.title}（${hash}）标记为已撤回`
      events.push(...propagateRetraction(state, key, hash, item.itemId, note))
    } else if (target?.status === '已撤回') {
      hash = target.contentHash
      result = 'retraction-deduped'
      note = '同一版撤回件重复送达，只留一条回执'
    } else {
      result = 'retraction-target-missing'
      note = '撤回件指向的来源版本未入库，登记回执待后续匹配'
    }
    return { state, receipt: receipt(item, result, key, url, hash, note, receivedAt), events }
  }

  const pending = isHashPending(item.contentHash)
  const incomingHash = pending ? '' : normalizeHash(item.contentHash as string)

  // —— 旧来源缺哈希：先待核，不能直接参与发布 ——
  if (pending) {
    let entry = state.registry.find((candidate) => candidate.key === key && isHashPending(candidate.contentHash))
    if (entry) {
      entry.receiptCount += 1
      entry.lastReceivedAt = receivedAt
      result = 'deduped'
      note = '相同地址的无哈希回调重复送达，待核条目只留一条，等待哈希补齐'
    } else {
      entry = {
        key, url, title: item.title ?? url, publisher: item.publisher ?? '', publishedAt: item.publishedAt ?? receivedAt.slice(0, 10),
        kind: item.evidenceKind ?? '待证信息', chainOfCustody: item.chainOfCustody ?? '舆情回调送达，内容哈希缺失', contentHash: '',
        status: '待核', firstReceivedAt: receivedAt, lastReceivedAt: receivedAt, receiptCount: 1, verifications: [], siblingHashes: []
      }
      state.registry.push(entry)
      refreshSiblingHashes(state.registry, key)
      result = 'pending-hash'
      note = '旧来源缺内容哈希，登记为待核版本；补哈希前不能参与发布'
    }
    hash = ''
    return { state, receipt: receipt(item, result, key, url, hash, note, receivedAt), events }
  }

  const sameHash = findVersion(state.registry, key, incomingHash)
  if (sameHash) {
    // —— 相同哈希只留一条：两名核查员同时提交同一来源版本 ——
    sameHash.receiptCount += 1
    sameHash.lastReceivedAt = receivedAt
    if (item.checker) {
      const prior = sameHash.verifications.find((verification) => verification.checker === item.checker)
      if (prior) {
        result = 'deduped'
        note = `相同哈希重复送达（${item.checker} 重复提交），只留一条收件记录`
      } else {
        const baseline = sameHash.verifications[0]
        const matched = !baseline || baseline.matched === false ? true : baseline.contentHash === incomingHash
        sameHash.verifications.push({ checker: item.checker, contentHash: incomingHash, matched, receivedAt, note: matched ? '与已存版本哈希一致，仅留比对值' : '比对不一致' })
        if (matched) {
          result = 'verification-only'
          note = baseline
            ? `${item.checker} 与 ${baseline.checker} 同时提交同一来源版本，后到者只留比对值（哈希一致）`
            : `${item.checker} 的比对值已登记`
        } else {
          result = 'new-version'
          note = `${item.checker} 提交的哈希与已存版本不一致，需另案核验`
        }
      }
    } else {
      result = 'deduped'
      note = '相同哈希的舆情回调重复送达，只留一条收件记录'
    }
    hash = incomingHash
    return { state, receipt: receipt(item, result, key, url, hash, note, receivedAt), events }
  }

  // —— 哈希补齐（显式标记）：待核条目升级为有效版本；否则视为同址改版，待核条目保留 ——
  const pendingEntry = item.hashCompletion
    ? state.registry.find((candidate) => candidate.key === key && isHashPending(candidate.contentHash))
    : undefined
  if (pendingEntry) {
    pendingEntry.contentHash = incomingHash
    pendingEntry.status = '有效'
    pendingEntry.title = item.title ?? pendingEntry.title
    pendingEntry.publisher = item.publisher ?? pendingEntry.publisher
    pendingEntry.publishedAt = item.publishedAt ?? pendingEntry.publishedAt
    pendingEntry.kind = item.evidenceKind ?? pendingEntry.kind
    pendingEntry.chainOfCustody = item.chainOfCustody ?? pendingEntry.chainOfCustody
    pendingEntry.lastReceivedAt = receivedAt
    if (item.checker) pendingEntry.verifications.push({ checker: item.checker, contentHash: incomingHash, matched: true, receivedAt, note: '随哈希补齐提交' })
    refreshSiblingHashes(state.registry, key)
    result = 'hash-upgraded'
    note = '待核来源补齐内容哈希，升级为有效版本，可参与引用与发布'
    hash = incomingHash
    events.push(...reconcileFacts(state, key))
    return { state, receipt: receipt(item, result, key, url, hash, note, receivedAt), events }
  }

  // —— 不同哈希保留两版（待核旧条目不覆盖，继续等待补哈希） ——
  const family = siblingsOf(state.registry, key)
  const pendingKept = state.registry.some((candidate) => candidate.key === key && isHashPending(candidate.contentHash))
  const entry: SourceVersion = {
    key, url, title: item.title ?? url, publisher: item.publisher ?? '', publishedAt: item.publishedAt ?? receivedAt.slice(0, 10),
    kind: item.evidenceKind ?? '二次来源', chainOfCustody: item.chainOfCustody ?? '舆情回调送达', contentHash: incomingHash,
    status: '有效', firstReceivedAt: receivedAt, lastReceivedAt: receivedAt, receiptCount: 1,
    verifications: item.checker ? [{ checker: item.checker, contentHash: incomingHash, matched: true, receivedAt, note: '首位提交核查员' }] : [],
    siblingHashes: []
  }
  state.registry.push(entry)
  refreshSiblingHashes(state.registry, key)
  result = family.length > 0 || pendingKept ? 'new-version' : 'registered'
  note = family.length > 0 || pendingKept
    ? pendingKept
      ? '公开地址出现新内容哈希：作为改版另存新版本，缺哈希的旧待核条目保留待补；引用该地址但未钉住版本的事实标记为“引用不确定版本”'
      : `公开地址出现新内容哈希，保留第 ${family.length + 1} 版（旧版不覆盖）；引用该地址但未钉住版本的事实标记为“引用不确定版本”`
    : '来源版本首次登记'
  hash = incomingHash
  events.push(...reconcileFacts(state, key))
  return { state, receipt: receipt(item, result, key, url, hash, note, receivedAt), events }
}

function receipt(item: IntakeItem, result: DeliveryReceipt['result'], key: string, url: string, hash: string, note: string, processedAt: string): DeliveryReceipt {
  return { itemId: item.itemId, kind: item.kind, result, sourceKey: key, url, hash, checker: item.checker, note, processedAt }
}

/** 撤回件传播：未发布结论失效重算；已发布快照只标记、仍可追 */
function propagateRetraction(state: ChainState, key: string, hash: string, retractionItemId: string, detail: string): ChainEvent[] {
  const events: ChainEvent[] = []
  for (const claim of state.claims) {
    for (const fact of claim.facts) {
      const usesVersion = factSources(fact).some((source) => source.sourceKey === key && normalizeHash(source.contentHash) === hash)
      const pinned = pinnedHashOf(fact, key) === hash
      if (!usesVersion && !pinned) continue

      if (claim.status === '已发布') {
        // 已发布结论不改动，仅快照留痕
        continue
      }
      // 未发布结论失效：清空结论与置信度，疑点与系统批注强制重算
      const prior = fact.unresolved.find((item) => item.includes('引用版本已被撤回'))
      if (!prior) fact.unresolved = [...fact.unresolved, `引用版本已被撤回（撤回件 ${retractionItemId}），结论失效待重算`]
      fact.conclusion = '证据不足'
      fact.confidence = 0
      markUncertain(fact, key, hash, `引用版本 ${hash.slice(0, 16)} 已撤回`, true)
      const systemNote = fact.annotations.find((annotation) => annotation.role === '系统' && annotation.refSourceKey === key && annotation.refHash === hash)
      if (!systemNote) {
        fact.annotations.unshift({
          id: `N-SYS-${retractionItemId}-${fact.id}`, author: '收件链', role: '系统', resolved: false,
          content: `依赖版本（${hash}）的撤回件已到达，未发布结论失效并已置为“证据不足”，请依据可追版本重算。`,
          createdAt: nowIso(), refSourceKey: key, refHash: hash
        })
      }
      events.push({ type: 'fact-invalidated', claimId: claim.id, factId: fact.id, key, hash, detail })
      events.push({ type: 'recompute', claimId: claim.id, factId: fact.id, detail: '未发布结论失效，等待核查员重算' })
    }
    if (claim.status === '已发布') {
      for (const snapshot of state.snapshots.filter((item) => item.claimId === claim.id)) {
        const used = snapshot.claim.facts.some((fact) => factSources(fact).some((source) => source.sourceKey === key && normalizeHash(source.contentHash) === hash))
        if (used && !snapshot.retractedHashes.includes(hash)) {
          snapshot.retractedHashes.push(hash)
          snapshot.status = '发布后来源撤回'
          snapshot.note = `${snapshot.note} 追踪：哈希 ${hash.slice(0, 16)} 于撤回件 ${retractionItemId} 后标记，快照内容不变仍可追。`
          events.push({ type: 'snapshot-retraction', claimId: claim.id, snapshotId: snapshot.id, hashes: [hash], detail })
        }
      }
    }
  }
  return events
}

/** 版本库出现新哈希后，回填来源卡片并标出引用不确定版本的事实 */
function reconcileFacts(state: ChainState, key: string): ChainEvent[] {
  const events: ChainEvent[] = []
  const family = state.registry.filter((entry) => entry.key === key)
  const hashSet = new Set(family.filter((entry) => !isHashPending(entry.contentHash)).map((entry) => normalizeHash(entry.contentHash)))
  const versions = hashSet.size
  for (const claim of state.claims) {
    for (const fact of claim.facts) {
      for (const source of factSources(fact)) {
        if (sourceKeyOf(source.url) !== key) continue
        source.sourceKey = key
        const matched = family.find((entry) => !isHashPending(entry.contentHash) && normalizeHash(entry.contentHash) === normalizeHash(source.contentHash))
        source.status = matched?.status ?? '待核'
        source.retractedAt = matched?.retractedAt
      }
      const touchesKey = factSources(fact).some((source) => sourceKeyOf(source.url) === key)
      if (!touchesKey) continue
      const pinned = pinnedHashOf(fact, key)
      if (versions > 1 && (pinned === null || !hashSet.has(pinned))) {
        markUncertain(fact, key, pinned, `公开地址存在 ${versions} 个内容哈希，该事实未钉住确定版本`, false)
        if (!fact.unresolved.some((item) => item.includes('引用版本不确定'))) {
          fact.unresolved = [...fact.unresolved, '引用版本不确定：同一公开地址存在多版内容，请钉住哈希后再发布']
        }
        events.push({ type: 'fact-uncertain', claimId: claim.id, factId: fact.id, key, hash: pinned, detail: '标出引用不确定版本' })
      } else if (pinned && hashSet.has(pinned)) {
        // 已钉住确定版本：解除之前的不确定标记
        fact.uncertainRefs = (fact.uncertainRefs ?? []).filter((ref) => ref.sourceKey !== key)
        fact.unresolved = fact.unresolved.filter((item) => !item.includes('引用版本不确定'))
      }
    }
  }
  return events
}

function markUncertain(fact: ClaimFact, key: string, hash: string | null, reason: string, invalidated: boolean): void {
  const refs = fact.uncertainRefs ?? (fact.uncertainRefs = [])
  const existing = refs.find((ref) => ref.sourceKey === key)
  const payload: UncertainRef = { sourceKey: key, url: key.replace(/^URL:/, ''), pinnedHash: hash, reason, markedAt: nowIso(), invalidated }
  if (existing) Object.assign(existing, payload)
  else refs.push(payload)
}

export function factSources(fact: ClaimFact): SourceRecord[] {
  return [...fact.sources, ...fact.counterSources]
}

function cloneState(state: ChainState): ChainState {
  return {
    registry: state.registry.map((entry) => ({ ...entry, verifications: entry.verifications.map((verification) => ({ ...verification })), siblingHashes: [...entry.siblingHashes] })),
    claims: state.claims.map((claim) => ({ ...claim, facts: claim.facts.map((fact) => ({ ...fact, sources: fact.sources.map((source) => ({ ...source })), counterSources: fact.counterSources.map((source) => ({ ...source })), annotations: fact.annotations.map((annotation) => ({ ...annotation })), unresolved: [...fact.unresolved], versionRefs: { ...(fact.versionRefs ?? {}) }, uncertainRefs: (fact.uncertainRefs ?? []).map((ref) => ({ ...ref })) })) })),
    snapshots: state.snapshots.map((snapshot) => ({ ...snapshot, retractedHashes: [...snapshot.retractedHashes], claim: structuredClone(snapshot.claim) }))
  }
}

/** 把来源卡片钉到确定版本哈希；发布前的人工裁决 */
export function pinFactVersion(prev: ChainState, claimId: string, factId: string, key: string, hash: string): ChainState {
  const state = cloneState(prev)
  const fact = state.claims.find((claim) => claim.id === claimId)?.facts.find((item) => item.id === factId)
  if (!fact) return prev
  fact.versionRefs = { ...(fact.versionRefs ?? {}), [key]: normalizeHash(hash) }
  fact.uncertainRefs = (fact.uncertainRefs ?? []).filter((ref) => ref.sourceKey !== key)
  fact.unresolved = fact.unresolved.filter((item) => !item.includes('引用版本不确定'))
  for (const source of factSources(fact)) {
    if (source.sourceKey === key) {
      source.status = normalizeHash(source.contentHash) === normalizeHash(hash) ? '有效' : source.status
    }
  }
  return state
}

/** 发布前校验：待核/撤回来源、引用不确定版本都会阻断发布 */
export function publishGate(claim: Claim): string[] {
  const blocking: string[] = []
  for (const fact of claim.facts) {
    for (const source of factSources(fact)) {
      const key = source.sourceKey ?? sourceKeyOf(source.url)
      if (isHashPending(source.contentHash)) blocking.push(`${fact.id} 的来源《${source.title}》缺内容哈希，处于待核状态`)
      if (source.status === '已撤回' || source.retractedAt) blocking.push(`${fact.id} 引用的《${source.title}》版本已撤回`)
    }
    for (const ref of fact.uncertainRefs ?? []) {
      blocking.push(`${fact.id} 引用不确定版本：${ref.url}`)
    }
  }
  return [...new Set(blocking)]
}

export function makeSnapshot(claim: Claim, editor: string, note: string): PublishedSnapshot {
  return {
    id: `PUB-${claim.id}-${claim.version}-${Date.now()}`,
    claimId: claim.id,
    claimTitle: claim.title,
    version: claim.version,
    editor,
    publishedAt: nowIso(),
    status: '发布有效',
    retractedHashes: [],
    note,
    claim: structuredClone(claim)
  }
}
