import assert from 'node:assert'
import { seedClaims } from './src/data/seed'
import { isHashPending, normalizeHash, pinFactVersion, processIntakeBatch, publishGate, sourceKeyOf } from './src/services/intakeChain'
import {
  dualCheckerBatch, duplicateDeliveryBatch, newHashBatch, pendingHashBatch, pendingHashUpgradeBatch,
  publishedRetractionBatch, retractionBatch, writeFailureBatch
} from './src/data/demoBatches'
import type { ChainState } from './src/services/intakeChain'

function buildRegistry(claims: any[]) {
  const registry = new Map<string, any>()
  for (const claim of claims) for (const fact of claim.facts) for (const source of [...fact.sources, ...fact.counterSources]) {
    const key = sourceKeyOf(source.url)
    source.sourceKey = key
    const pending = isHashPending(source.contentHash)
    source.status = pending ? '待核' : '有效'
    if (pending) source.contentHash = ''
    else source.contentHash = normalizeHash(source.contentHash)
    fact.versionRefs = { ...(fact.versionRefs ?? {}), ...(pending ? {} : { [key]: source.contentHash }) }
    const mapKey = `${key}|${source.contentHash}`
    if (registry.has(mapKey)) registry.get(mapKey).receiptCount += 1
    else registry.set(mapKey, { key, url: source.url, title: source.title, publisher: source.publisher, publishedAt: source.publishedAt, kind: source.kind, chainOfCustody: source.chainOfCustody, contentHash: source.contentHash, status: pending ? '待核' : '有效', firstReceivedAt: source.capturedAt, lastReceivedAt: source.capturedAt, receiptCount: 1, verifications: [], siblingHashes: [] })
  }
  const list = [...registry.values()]
  for (const entry of list) entry.siblingHashes = list.filter((o: any) => o.key === entry.key && o !== entry && o.contentHash).map((o: any) => o.contentHash)
  return list
}

function freshState(): ChainState {
  const claims = structuredClone(seedClaims)
  const registry = buildRegistry(claims)
  return { registry, claims, snapshots: [] }
}

let state = freshState()
const failures = 0

function run(input: ReturnType<typeof duplicateDeliveryBatch>) {
  const out = processIntakeBatch(state, input)
  if (!out.result) throw new Error(`批次 ${input.batchId} 意外失败`)
  state = out.result.state
  return out
}

// 1) 重复回调：同哈希只留一条
let out = run(duplicateDeliveryBatch())
assert.equal(out.result!.state.registry.filter((e) => e.url === 'https://example.gov.cn/water/0928').length, 1, '同址同哈希应只有一条版本')
const water = out.result!.state.registry.find((e) => e.url === 'https://example.gov.cn/water/0928')!
assert.equal(water.receiptCount, seedHas('https://example.gov.cn/water/0928') + 3, 'receiptCount 应累加3次回调')
assert.deepEqual(out.result!.receipts.filter((r) => r.result === 'deduped').length === 3, true, '三条重复回调都应为 deduped（种子已有同哈希）')
console.log('✓ 相同哈希只留一条，重复送达记为 deduped')

// 2) 同址不同哈希：保留多版，F-3 标引用不确定版本
out = run(newHashBatch())
const noticeKey = sourceKeyOf('https://example.gov.cn/fire/notice-77')
const family = out.result!.state.registry.filter((e) => e.key === noticeKey)
assert.equal(family.length, 3, '公示地址应保留 待核+2新 共3条条目')
const f3 = out.result!.state.claims.find((c) => c.id === 'FC-260929-01')!.facts.find((f) => f.id === 'F-3')!
assert.equal((f3.uncertainRefs ?? []).some((r) => r.sourceKey === noticeKey), true, 'F-3 应被标引用不确定版本')
assert.ok(f3.unresolved.some((u) => u.includes('引用版本不确定')))
assert.ok(publishGate(out.result!.state.claims.find((c) => c.id === 'FC-260929-01')!).some((m) => m.includes('引用不确定版本')), '发布门禁应拦截不确定版本')
console.log('✓ 不同哈希保留两版并标出引用不确定版本，发布被拦截')

// 2b) 钉住有效版本后解除
state = pinFactVersion(state, 'FC-260929-01', 'F-3', noticeKey, 'sha256:a77e51...b80d')
const f3b = state.claims.find((c) => c.id === 'FC-260929-01')!.facts.find((f) => f.id === 'F-3')!
assert.equal((f3b.uncertainRefs ?? []).filter((r) => r.sourceKey === noticeKey).length, 0, '钉版后不确定标记应解除')
console.log('✓ 钉住确定哈希后解除不确定阻断')

// 3) 两名核查员同版本并发：后到只留比对值
out = run(dualCheckerBatch())
const envEntry = out.result!.state.registry.find((e) => e.url === 'https://example.gov.cn/env/0929')!
assert.equal(envEntry.verifications.some((v) => v.checker === '顾薇' && v.matched === true), true, '顾薇应留下 matched 比对值')
assert.equal(out.result!.state.registry.filter((e) => e.url === 'https://example.gov.cn/env/0929').length, 1, '同版本不得新增卡片')
const dualReceipts = out.batch.receipts.map((r) => r.result).sort()
assert.ok(dualReceipts.includes('verification-only'), '后到者结果应为 verification-only')
console.log('✓ 两人提交同一版本：后到者只留比对值，不新增来源版本')

// 4) 缺哈希旧来源先待核
out = run(pendingHashBatch())
const memo = out.result!.state.registry.find((e) => e.url === 'https://repost.example.net/load-memo')!
assert.equal(memo.status, '待核')
assert.equal(memo.contentHash, '')
console.log('✓ 缺哈希来源登记为待核')

// 4b) 补齐哈希升级
out = run(pendingHashUpgradeBatch())
const memo2 = out.result!.state.registry.find((e) => e.url === 'https://repost.example.net/load-memo')!
assert.equal(memo2.status, '有效')
assert.equal(memo2.contentHash, 'sha256:8f21ba...7c4e')
assert.equal(out.result!.receipts[0].result, 'hash-upgraded')
console.log('✓ 待核件补齐哈希后升级为有效版本')

// 5) 写入失败 + 恢复只补未完成项
const failInput = writeFailureBatch()
const failed = processIntakeBatch(state, failInput)
assert.equal(failed.result, undefined, '第2项失败时批次应中断')
assert.equal(failed.batch.status, '部分失败')
assert.equal(failed.batch.receipts.length, 1, '只有第1项有回执')
assert.equal(state.registry.some((e) => e.url === 'https://example.gov.cn/water/tap-1005'), false, '第3项在失败时不得落盘')
// 模拟 store 落盘失败批次后恢复：保留第1项回执，仅补第2、3项
const retry = processIntakeBatch(state, failInput, failed.batch, true)
assert.ok(retry.result, '恢复应成功')
assert.equal(retry.result!.receipts.length, 3, '恢复后3项全部有回执（保留旧回执+补2条）')
const results = retry.batch.receipts.map((r) => r.result)
assert.equal(results[0], 'registered', '第1项保留原始回执')
assert.equal(retry.result!.state.registry.some((e) => e.url === 'https://example.gov.cn/water/tap-1005'), true, '第3项应已补写')
assert.equal(retry.batch.status, '已处理')
assert.ok(retry.result!.events.some((e) => e.type === 'recovered'), '应产生 recovered 事件')
state = retry.result!.state
console.log('✓ 写入失败保留完整批次；恢复仅补未完成项，旧回执不重算')

// 6) 撤回件（未发布主张 FC-260929-01 的 F-2 截图）
const f2before = state.claims.find((c) => c.id === 'FC-260929-01')!.facts.find((f) => f.id === 'F-2')!
const beforeConclusion = f2before.conclusion
out = run(retractionBatch())
const f2 = out.result!.state.claims.find((c) => c.id === 'FC-260929-01')!.facts.find((f) => f.id === 'F-2')!
assert.equal(f2.conclusion, '证据不足', '未发布结论应失效为证据不足')
assert.equal(f2.confidence, 0)
assert.ok(f2.unresolved.some((u) => u.includes('引用版本已被撤回')))
assert.ok(f2.annotations.some((a) => a.role === '系统' && a.content.includes('失效')))
assert.equal(out.batch.receipts.filter((r) => r.result === 'retracted').length, 1)
assert.equal(out.batch.receipts.filter((r) => r.result === 'retraction-deduped').length, 1, '重复撤回件应去重')
const social = out.result!.state.registry.find((e) => e.url === 'https://social.example/post/9901')!
assert.equal(social.status, '已撤回')
console.log(`✓ 撤回件使未发布结论失效（${beforeConclusion} → 证据不足），重复撤回去重`)

// 7) 已发布主张：快照保留，撤回只标记
let pubState = freshState()
const claim2 = pubState.claims.find((c) => c.id === 'FC-260928-03')!
claim2.status = '已发布'
claim2.facts.forEach((f) => { f.unresolved = [] })
const gateBefore = publishGate(claim2)
assert.equal(gateBefore.length, 0, '种子 FC-260928-03 发布前应无收件链阻断')
pubState.snapshots = [{ id: 'PUB-TEST', claimId: claim2.id, claimTitle: claim2.title, version: claim2.version, editor: '宋卓', publishedAt: '2026-10-05T08:00:00Z', status: '发布有效', retractedHashes: [], note: '发布', claim: structuredClone(claim2) }]
const pubOut = processIntakeBatch(pubState, publishedRetractionBatch())
assert.ok(pubOut.result)
pubState = pubOut.result!.state
const liveClaim = pubState.claims.find((c) => c.id === 'FC-260928-03')!
const f4 = liveClaim.facts.find((f) => f.id === 'F-4')!
assert.notEqual(f4.conclusion, '证据不足', '已发布工作稿结论不应被撤回自动改写')
const snap = pubState.snapshots.find((s) => s.id === 'PUB-TEST')!
assert.equal(snap.status, '发布后来源撤回')
assert.deepEqual(snap.retractedHashes, ['sha256:228a2...09cf'])
assert.equal(snap.claim.facts.find((f) => f.id === 'F-4')!.sources[0].status, '有效', '快照内来源状态停留在发布瞬间')
console.log('✓ 已发布快照在撤回后内容不变、标记撤回哈希且仍可追')

// 8) 旧来源缺哈希不能直接通过发布门禁
const gate = publishGate(freshState().claims.find((c) => c.id === 'FC-260929-01')!)
assert.ok(gate.some((m) => m.includes('待核')), '种子里 S-6 缺哈希，应被发布门禁拦截')
console.log('✓ 缺哈希旧来源被发布前校验拦截')

console.log(`\n全部收件链断言通过（失败数 ${failures}）`)

function seedHas(url: string) {
  return freshState().registry.filter((e) => e.url === url).reduce((n, e) => n + e.receiptCount, 0)
}
