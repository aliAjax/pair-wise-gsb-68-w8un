export type ClaimStatus = '核查中' | '待编辑复核' | '已发布' | '已撤回'
export type FactConclusion = '已证实' | '部分属实' | '证据不足' | '不实'
export type EvidenceKind = '原始证据' | '二次来源' | '待证信息'

/** 来源版本在收件链中的核验状态：缺哈希待核 / 哈希已核验 / 撤回件已到 */
export type SourceVersionStatus = '待核' | '有效' | '已撤回'
/** 发布快照当前可追状态：发布后被撤回件命中时标记，快照本身不可变 */
export type SnapshotStatus = '发布有效' | '发布后来源撤回'

export interface CheckerVerification {
  checker: string
  contentHash: string
  matched: boolean
  receivedAt: string
  note: string
}

/**
 * 来源版本库条目：公开地址相同但内容哈希不同时，按哈希各保留一版，
 * 不再让来源卡片互相覆盖。事实只通过 sourceKey + pinnedHash 引用确定版本。
 */
export interface SourceVersion {
  key: string
  url: string
  title: string
  publisher: string
  publishedAt: string
  kind: EvidenceKind
  chainOfCustody: string
  contentHash: '' | string
  status: SourceVersionStatus
  firstReceivedAt: string
  lastReceivedAt: string
  receiptCount: number
  verifications: CheckerVerification[]
  /** 撤回件回执来源（舆情回调撤回通知） */
  retractedBy?: string
  retractedAt?: string
  /** 该公开地址上已出现的其他版本哈希，用于标出“引用不确定版本”的事实 */
  siblingHashes: string[]
}

export interface SourceRecord {
  id: string
  title: string
  url: string
  publisher: string
  publishedAt: string
  capturedAt: string
  kind: EvidenceKind
  chainOfCustody: string
  contentHash: string
  version: number
  supersededBy?: string
  // —— 收件链核验信息（reconcile 时从来源版本库回填）——
  sourceKey?: string
  status?: SourceVersionStatus
  retractedAt?: string
}

export type ClaimAnnotationRole = '记者' | '编辑' | '事实核查员' | '系统'

export interface ClaimAnnotation {
  id: string
  author: string
  role: ClaimAnnotationRole
  content: string
  createdAt: string
  resolved: boolean
  /** 系统批注与具体来源版本绑定，重算时按此键幂等去重 */
  refSourceKey?: string
  refHash?: string
}

export interface UncertainRef {
  sourceKey: string
  url: string
  /** null 表示事实引用时未指定版本（待证引用），版本库出现多版即不确定 */
  pinnedHash: string | null
  reason: string
  markedAt: string
  /** 撤回件到达导致的失效，未发布结论需要重算 */
  invalidated: boolean
}

export interface ClaimFact {
  id: string
  text: string
  conclusion: FactConclusion
  confidence: number
  unresolved: string[]
  sources: SourceRecord[]
  counterSources: SourceRecord[]
  annotations: ClaimAnnotation[]
  /** 每个来源版本的确定引用（sourceKey -> 内容哈希）；缺该键即引用不确定版本 */
  versionRefs?: Record<string, string>
  uncertainRefs?: UncertainRef[]
}

export interface Claim {
  id: string
  title: string
  summary: string
  reporter: string
  editor: string
  status: ClaimStatus
  priority: '低' | '中' | '高'
  createdAt: string
  updatedAt: string
  version: number
  facts: ClaimFact[]
}

export interface VersionRecord {
  id: string
  claimId: string
  version: number
  editor: string
  summary: string
  changedFactIds: string[]
  removedEvidence: string[]
  createdAt: string
}

export interface AuditEntry {
  id: string
  claimId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

/** 发布瞬间锁定的完整快照：撤回件只影响未发布结论，快照永久可追 */
export interface PublishedSnapshot {
  id: string
  claimId: string
  claimTitle: string
  version: number
  editor: string
  publishedAt: string
  status: SnapshotStatus
  retractedHashes: string[]
  note: string
  claim: Claim
}

/** 收件批次中单条回调项；retraction 项用 refHash 指明撤回哪一版 */
export interface IntakeItem {
  itemId: string
  kind: 'news' | 'retraction'
  title?: string
  url?: string
  publisher?: string
  publishedAt?: string
  evidenceKind?: EvidenceKind
  chainOfCustody?: string
  contentHash?: string
  checker?: string
  receivedAt: string
  refBatchId?: string
  refItemId?: string
  refHash?: string
  reason?: string
  /** true 表示本次送达是给同址待核条目补哈希（而非同页改版出新版本） */
  hashCompletion?: boolean
  /** 演示用：处理该项时模拟一次写入失败 */
  simulateWriteFailure?: boolean
}

export interface IntakeBatchInput {
  batchId: string
  source: string
  arrivedAt: string
  items: IntakeItem[]
}

export interface DeliveryReceipt {
  itemId: string
  kind: 'news' | 'retraction'
  result:
    | 'deduped'
    | 'registered'
    | 'new-version'
    | 'verification-only'
    | 'pending-hash'
    | 'hash-upgraded'
    | 'retracted'
    | 'retraction-deduped'
    | 'retraction-target-missing'
  sourceKey: string
  url: string
  hash: string
  checker?: string
  note: string
  processedAt: string
}

export interface IntakeBatch {
  id: string
  source: string
  arrivedAt: string
  items: IntakeItem[]
  status: '待处理' | '部分失败' | '已处理'
  receipts: DeliveryReceipt[]
  processedAt?: string
  error?: string
}
