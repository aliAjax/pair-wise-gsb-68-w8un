export type ClaimStatus = '核查中' | '待编辑复核' | '已发布' | '已撤回'
export type FactConclusion = '已证实' | '部分属实' | '证据不足' | '不实'
export type EvidenceKind = '原始证据' | '二次来源' | '待证信息'

/** 来源内容版本的登记状态：缺哈希先待核；撤回件命中后置为已撤回 */
export type SourceState = '已核验' | '待核' | '已撤回'

/**
 * 来源以「公开地址 + 内容哈希」为唯一坐标登记在全局来源台账，
 * 不再内嵌在事实卡片中，避免同址卡片互相覆盖。
 */
export interface SourceVersion {
  id: string
  urlKey: string
  title: string
  url: string
  publisher: string
  publishedAt: string
  capturedAt: string
  kind: EvidenceKind
  chainOfCustody: string
  /** 为空表示旧来源/收件缺哈希，state 必须为待核 */
  contentHash: string
  state: SourceState
  /** 同一公开地址下的版本序号，从 1 开始 */
  versionNo: number
  receivedAt: string
  retractedAt?: string
  origin: '收件' | '人工' | '旧档'
}

/** 事实对来源的引用：钉住具体哈希版本，或只按公开地址引用（版本可能不确定） */
export interface FactSourceRef {
  refId: string
  counter: boolean
  pinned: boolean
  sourceId?: string
  urlKey?: string
  /** 钉住时冗余记录哈希，发布快照据此核验 */
  hash?: string
  since: string
}

/** 撤回件命中后，未发布事实的结论失效重算记录 */
export interface FactRecompute {
  required: boolean
  reason: string
  at: string
  sourceId?: string
  annotationIds: string[]
  prevConclusion?: FactConclusion
  prevConfidence?: number
  resolvedAt?: string
}

export interface ClaimAnnotation {
  id: string
  author: string
  role: '记者' | '编辑' | '事实核查员' | '系统'
  content: string
  createdAt: string
  resolved: boolean
}

export interface ClaimFact {
  id: string
  text: string
  conclusion: FactConclusion
  confidence: number
  unresolved: string[]
  sources: FactSourceRef[]
  counterSources: FactSourceRef[]
  annotations: ClaimAnnotation[]
  recompute?: FactRecompute
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
  /** 收件通道级事件没有所属主张时为空字符串 */
  claimId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

export type IntakeItemKind = '回调送达' | '撤回件'
/** 终态：恢复批次时不会重复处理；写入失败/待处理 可补做 */
export type IntakeItemStatus =
  | '已完成'
  | '已去重'
  | '待核'
  | '已撤回生效'
  | '已失效重算'
  | '撤回未匹配'
  | '写入失败'
  | '待处理'

export interface IntakeItem {
  itemId: string
  kind: IntakeItemKind
  title: string
  url: string
  publisher: string
  publishedAt: string
  contentHash: string
  evidenceKind: EvidenceKind
  chainOfCustody: string
  receivedAt: string
  status: IntakeItemStatus
  attempts: number
  sourceId?: string
  versionNo?: number
  resultNote?: string
  /** 回调可携带主张/事实上下文，送达后自动钉住引用 */
  claimId?: string
  factId?: string
  submitter?: string
}

export interface IntakeBatch {
  batchId: string
  channel: string
  receivedAt: string
  appliedAt?: string
  /** 所有条目都进入终态后才为 true，保证从完整批次恢复 */
  complete: boolean
  items: IntakeItem[]
}

export interface IngestItemInput {
  kind: IntakeItemKind
  url: string
  title?: string
  publisher?: string
  publishedAt?: string
  contentHash?: string
  evidenceKind?: EvidenceKind
  chainOfCustody?: string
  claimId?: string
  factId?: string
  submitter?: string
  counter?: boolean
  origin?: '收件' | '人工'
}

/** 发布瞬间冻结的不可变快照，之后来源撤回也不改动 */
export interface PublishSnapshot {
  id: string
  claimId: string
  claimVersion: number
  title: string
  publishedAt: string
  editor: string
  note: string
  claimCopy: Claim
  sourceCopies: SourceVersion[]
  factDigests: Array<{
    factId: string
    text: string
    conclusion: FactConclusion
    confidence: number
    refs: Array<{
      counter: boolean
      sourceId: string
      title: string
      url: string
      hash: string
      /** 冻结时刻的来源状态 */
      state: SourceState
    }>
  }>
}
