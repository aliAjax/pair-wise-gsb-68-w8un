import type { AuditEntry, Claim, IntakeBatch, PublishSnapshot, SourceVersion, VersionRecord } from '../types'

/**
 * 来源全局台账：同一公开地址下按内容哈希留存多版本。
 * - social.example/post/9901 有 V1/V2 两版（回调重复报道、哈希变了）
 * - vendor.example/white-paper 为旧档迁移，缺哈希，待核
 * - example.gov.cn/env/0929 V1 已被撤回，但 FC-260928-03 的发布快照仍冻结其已核验状态
 */
export const seedRegistry: SourceVersion[] = [
  { id: 'S-1', urlKey: 'https://example.gov.cn/report/2025-1102', title: '一期工程环境影响报告表', url: 'https://example.gov.cn/report/2025-1102', publisher: '市生态环境局', publishedAt: '2025-11-02', capturedAt: '2026-09-29T08:40:00', kind: '原始证据', chainOfCustody: '官网下载PDF，哈希时间戳已记录', contentHash: 'sha256:9d31f1...a42c', state: '已核验', versionNo: 1, receivedAt: '2026-09-29T08:40:00', origin: '人工' },
  { id: 'S-2', urlKey: 'https://example.com/tender/8821', title: '项目设备采购公告', url: 'https://example.com/tender/8821', publisher: '公共资源交易平台', publishedAt: '2026-01-18', capturedAt: '2026-09-29T08:52:00', kind: '原始证据', chainOfCustody: '官网页面快照与原始附件同时留存', contentHash: 'sha256:7bc029...de10', state: '已核验', versionNo: 1, receivedAt: '2026-09-29T08:52:00', origin: '人工' },
  { id: 'S-3', urlKey: 'https://social.example/post/9901', title: '匿名用户上传的验收文件局部截图（首版）', url: 'https://social.example/post/9901', publisher: '社交平台账号', publishedAt: '2026-09-28', capturedAt: '2026-09-29T09:05:00', kind: '待证信息', chainOfCustody: '已保存原帖与图片EXIF，待向主管部门核验', contentHash: 'sha256:1fe210...67bd', state: '已核验', versionNo: 1, receivedAt: '2026-09-29T09:05:00', origin: '人工' },
  { id: 'S-6', urlKey: 'https://social.example/post/9901', title: '匿名用户上传的验收文件局部截图（编辑后重发）', url: 'https://social.example/post/9901', publisher: '社交平台账号', publishedAt: '2026-09-29T15:50:00', capturedAt: '2026-09-29T15:52:00', kind: '待证信息', chainOfCustody: '舆情回调送达，公开地址不变但正文图片已被编辑，与V1并列留存', contentHash: 'sha256:8f02aa...11d7', state: '已核验', versionNo: 2, receivedAt: '2026-09-29T15:52:00', origin: '收件' },
  { id: 'S-7', urlKey: 'https://social.example/post/7742', title: '网友拍摄的柴发机房拆除现场（无哈希）', url: 'https://social.example/post/7742', publisher: '社交平台账号', publishedAt: '2026-09-29T17:00:00', capturedAt: '2026-09-29T17:05:00', kind: '待证信息', chainOfCustody: '回调条目缺少内容哈希，待补算后核验', contentHash: '', state: '待核', versionNo: 1, receivedAt: '2026-09-29T17:05:00', origin: '收件' },
  { id: 'C-1', urlKey: 'https://example.com/tender/9102', title: '储能系统招标文件仍列出柴发切换接口', url: 'https://example.com/tender/9102', publisher: '公共资源交易平台', publishedAt: '2026-03-04', capturedAt: '2026-09-29T14:10:00', kind: '原始证据', chainOfCustody: '附件原文留存，相关条款见第42页', contentHash: 'sha256:c7249a...001f', state: '已核验', versionNo: 1, receivedAt: '2026-09-29T14:10:00', origin: '人工' },
  { id: 'S-4', urlKey: 'https://vendor.example/white-paper', title: '设备厂商技术白皮书', url: 'https://vendor.example/white-paper', publisher: '设备厂商', publishedAt: '2026-05-12', capturedAt: '2026-09-29T11:10:00', kind: '二次来源', chainOfCustody: '厂商官网PDF留存；旧档迁移时缺少内容哈希，已置待核', contentHash: '', state: '待核', versionNo: 1, receivedAt: '2026-09-29T11:10:00', origin: '旧档' },
  { id: 'S-5', urlKey: 'https://example.gov.cn/water/0928', title: '市供水水质周报', url: 'https://example.gov.cn/water/0928', publisher: '市水务局', publishedAt: '2026-09-28', capturedAt: '2026-09-28T16:20:00', kind: '原始证据', chainOfCustody: '官网数据与PDF报告留存', contentHash: 'sha256:228a2...09cf', state: '已核验', versionNo: 1, receivedAt: '2026-09-28T16:20:00', origin: '人工' },
  { id: 'C-2', urlKey: 'https://example.gov.cn/env/0929', title: '上游排口在线监测与执法巡查记录', url: 'https://example.gov.cn/env/0929', publisher: '市生态环境局', publishedAt: '2026-09-29', capturedAt: '2026-09-29T12:00:00', kind: '原始证据', chainOfCustody: '官方接口导出CSV，记录数据签名；发布后收到撤回件：监测口径有误', contentHash: 'sha256:ab45d...9c31', state: '已撤回', versionNo: 1, receivedAt: '2026-09-29T12:00:00', retractedAt: '2026-10-02T09:30:00', origin: '人工' }
]

const pin = (refId: string, sourceId: string, hash: string, urlKey: string, since: string, counter = false) => ({ refId, counter, pinned: true, sourceId, urlKey, hash, since })
const loose = (refId: string, urlKey: string, since: string) => ({ refId, counter: false, pinned: false, urlKey, since })

export const seedClaims: Claim[] = [
  {
    id: 'FC-260929-01', title: '某地新建数据中心停用全部柴油应急电源', summary: '社交平台流传项目验收文件截图，称数据中心取消柴油发电机改为纯储能供电。',
    reporter: '沈言', editor: '宋卓', status: '待编辑复核', priority: '高', createdAt: '2026-09-29T08:10:00', updatedAt: '2026-09-29T17:05:00', version: 5,
    facts: [
      {
        id: 'F-1', text: '项目规划文件中曾包含2台柴油发电机组。', conclusion: '已证实', confidence: 98, unresolved: [],
        sources: [
          pin('R-1', 'S-1', 'sha256:9d31f1...a42c', 'https://example.gov.cn/report/2025-1102', '2026-09-29T08:40:00'),
          pin('R-2', 'S-2', 'sha256:7bc029...de10', 'https://example.com/tender/8821', '2026-09-29T08:52:00')
        ], counterSources: [],
        annotations: [{ id: 'N-1', author: '宋卓', role: '编辑', content: '请补充规划变更批复，不能用采购公告单独代表最终方案。', createdAt: '2026-09-29T10:20:00', resolved: false }]
      },
      {
        id: 'F-2', text: '最终验收已取消柴油应急电源。', conclusion: '证据不足', confidence: 42, unresolved: ['缺少竣工验收备案原件', '网传截图无文件编号与签章页'],
        // 仅按公开地址引用：回调重发后同址出现 V1/V2，该引用被系统标记为版本不确定
        sources: [loose('R-3', 'https://social.example/post/9901', '2026-09-29T09:05:00')],
        counterSources: [pin('R-4', 'C-1', 'sha256:c7249a...001f', 'https://example.com/tender/9102', '2026-09-29T14:10:00', true)],
        annotations: [
          { id: 'N-3', author: '收件链', role: '系统', content: '来源公开地址 https://social.example/post/9901 出现 V2 新版本，该事实仅按地址引用、未钉哈希，引用版本不确定，发布前必须钉版。', createdAt: '2026-09-29T15:52:00', resolved: false },
          { id: 'N-2', author: '陆衡', role: '事实核查员', content: '该结论不得以匿名截图单独成立，需取得主管部门书面确认。', createdAt: '2026-09-29T14:25:00', resolved: false }
        ]
      },
      {
        id: 'F-3', text: '纯储能方案足以覆盖消防和一级负荷供电。', conclusion: '部分属实', confidence: 40, unresolved: ['缺少负荷计算书', '缺少消防验收文件'],
        sources: [{ refId: 'R-5', counter: false, pinned: false, sourceId: 'S-4', urlKey: 'https://vendor.example/white-paper', since: '2026-09-29T11:10:00' }],
        counterSources: [], annotations: []
      }
    ]
  },
  {
    id: 'FC-260928-03', title: '城区供水异味来自河道藻类暴发', summary: '居民投诉自来水异味，网络传言指向上游工业排放，需核查水质报告与采样链。该主张已于9月30日发布，10月2日其引用的监测记录被撤回。',
    reporter: '顾薇', editor: '宋卓', status: '已发布', priority: '中', createdAt: '2026-09-28T09:00:00', updatedAt: '2026-10-02T09:30:00', version: 3,
    facts: [
      { id: 'F-4', text: '多个采样点的2-甲基异莰醇检测值超过嗅阈值。', conclusion: '已证实', confidence: 93, unresolved: [], sources: [pin('R-6', 'S-5', 'sha256:228a2...09cf', 'https://example.gov.cn/water/0928', '2026-09-28T16:20:00')], counterSources: [], annotations: [] },
      {
        id: 'F-5', text: '异味由上游企业偷排直接造成。', conclusion: '不实', confidence: 88, unresolved: [], sources: [],
        counterSources: [pin('R-7', 'C-2', 'sha256:ab45d...9c31', 'https://example.gov.cn/env/0929', '2026-09-29T12:00:00', true)],
        annotations: [{ id: 'N-4', author: '收件链', role: '系统', content: '来源出现撤回件：该主张已发布，引用版本冻结在发布快照 SNAP-1 中，仍可追溯，现结论不自动失效。', createdAt: '2026-10-02T09:30:00', resolved: true }]
      }
    ]
  }
]

export const seedVersions: VersionRecord[] = [
  { id: 'V-3', claimId: 'FC-260928-03', version: 3, editor: '宋卓', summary: '发布正式版本，全部引用钉住哈希并冻结发布快照 SNAP-1。', changedFactIds: ['F-4', 'F-5'], removedEvidence: [], createdAt: '2026-09-30T10:00:00' },
  { id: 'V-1', claimId: 'FC-260929-01', version: 4, editor: '沈言', summary: '补充储能系统招标文件和相反证据，降低第二、第三项事实置信度。', changedFactIds: ['F-2', 'F-3'], removedEvidence: ['匿名聊天记录截图'], createdAt: '2026-09-29T15:30:00' },
  { id: 'V-2', claimId: 'FC-260929-01', version: 3, editor: '陆衡', summary: '补充匿名截图保管链和未解决疑点。', changedFactIds: ['F-2'], removedEvidence: [], createdAt: '2026-09-29T14:25:00' }
]

/** 收件批次：批次保留全部条目原始载荷，失败项可从批次完整重放、只补未完成项 */
export const seedBatches: IntakeBatch[] = [
  {
    batchId: 'BATCH-261002-01', channel: '舆情回调 / 撤回通道', receivedAt: '2026-10-02T09:28:00', appliedAt: '2026-10-02T09:30:00', complete: true,
    items: [
      { itemId: 'ITM-4', kind: '撤回件', title: '上游排口在线监测与执法巡查记录', url: 'https://example.gov.cn/env/0929', publisher: '市生态环境局', publishedAt: '2026-09-29', contentHash: 'sha256:ab45d...9c31', evidenceKind: '原始证据', chainOfCustody: '官方通知监测口径有误，撤回该版数据', receivedAt: '2026-10-02T09:28:00', status: '已撤回生效', attempts: 1, sourceId: 'C-2', versionNo: 1, resultNote: '版本已撤回，FC-260928-03 已发布，快照 SNAP-1 冻结不受影响，仍可追溯' }
    ]
  },
  {
    batchId: 'BATCH-260929-07', channel: '舆情回调 / 报道更新', receivedAt: '2026-09-29T15:50:00', appliedAt: '2026-09-29T17:06:00', complete: false,
    items: [
      { itemId: 'ITM-1', kind: '回调送达', title: '匿名用户上传的验收文件局部截图', url: 'https://social.example/post/9901', publisher: '社交平台账号', publishedAt: '2026-09-29T15:50:00', contentHash: 'sha256:1fe210...67bd', evidenceKind: '待证信息', chainOfCustody: '回调重推同一篇报道', receivedAt: '2026-09-29T15:50:00', status: '已去重', attempts: 1, sourceId: 'S-3', versionNo: 1, resultNote: '与 S-3 V1 哈希一致，仅留存比对值，不重复建卡' },
      { itemId: 'ITM-2', kind: '回调送达', title: '匿名用户上传的验收文件局部截图（编辑后重发）', url: 'https://social.example/post/9901', publisher: '社交平台账号', publishedAt: '2026-09-29T15:50:00', contentHash: 'sha256:8f02aa...11d7', evidenceKind: '待证信息', chainOfCustody: '公开地址不变、内容哈希变化，与V1并存', receivedAt: '2026-09-29T15:52:00', status: '已完成', attempts: 1, sourceId: 'S-6', versionNo: 2, resultNote: '同址哈希变化，已保留为 V2，未钉版引用标记为版本不确定', claimId: 'FC-260929-01', factId: 'F-2' },
      { itemId: 'ITM-3', kind: '回调送达', title: '网友拍摄的柴发机房拆除现场（无哈希）', url: 'https://social.example/post/7742', publisher: '社交平台账号', publishedAt: '2026-09-29T17:00:00', contentHash: '', evidenceKind: '待证信息', chainOfCustody: '回调条目缺少内容哈希', receivedAt: '2026-09-29T17:05:00', status: '待核', attempts: 1, sourceId: 'S-7', versionNo: 1, resultNote: '缺内容哈希，已置待核，不参与发布' },
      { itemId: 'ITM-5', kind: '回调送达', title: '项目监理例会纪要（页面试写失败）', url: 'https://example.com/meeting/minutes-17', publisher: '项目监理单位', publishedAt: '2026-09-29T16:30:00', contentHash: 'sha256:51be73...9a04', evidenceKind: '原始证据', chainOfCustody: '写入台账时存储超时', receivedAt: '2026-09-29T17:06:00', status: '写入失败', attempts: 1, resultNote: '模拟存储写入超时；批次条目保留，恢复时只补本项' }
    ]
  }
]

export const seedSnapshots: PublishSnapshot[] = [
  (() => {
    const claim = seedClaims.find((item) => item.id === 'FC-260928-03')!
    const at = '2026-09-30T10:00:00'
    const s5 = seedRegistry.find((item) => item.id === 'S-5')!
    const c2 = { ...seedRegistry.find((item) => item.id === 'C-2')!, state: '已核验' as const, retractedAt: undefined }
    return {
      id: 'SNAP-1', claimId: 'FC-260928-03', claimVersion: 3, title: claim.title, publishedAt: at, editor: '宋卓',
      note: '发布正式版本：所有引用钉住内容哈希，监测记录以发布时刻的已核验状态冻结。',
      claimCopy: structuredClone(claim),
      sourceCopies: [structuredClone(s5), structuredClone(c2)],
      factDigests: [
        { factId: 'F-4', text: claim.facts[0].text, conclusion: '已证实', confidence: 93, refs: [{ counter: false, sourceId: 'S-5', title: s5.title, url: s5.url, hash: s5.contentHash, state: '已核验' }] },
        { factId: 'F-5', text: claim.facts[1].text, conclusion: '不实', confidence: 88, refs: [{ counter: true, sourceId: 'C-2', title: c2.title, url: c2.url, hash: c2.contentHash, state: '已核验' }] }
      ]
    }
  })()
]

export const seedAudit: AuditEntry[] = [
  { id: 'A-1', claimId: 'FC-260929-01', action: '建立核查主张', operator: '沈言', detail: '创建3项可验证事实', createdAt: '2026-09-29T08:10:00' },
  { id: 'A-2', claimId: 'FC-260929-01', action: '关联原始证据', operator: '沈言', detail: '关联环评报告和设备采购公告并钉住哈希', createdAt: '2026-09-29T08:55:00' },
  { id: 'A-3', claimId: 'FC-260929-01', action: '添加相反证据', operator: '陆衡', detail: '储能招标附件与纯储能结论冲突，保留争议', createdAt: '2026-09-29T14:10:00' },
  { id: 'A-4', claimId: '', action: '同哈希去重', operator: '舆情回调', detail: 'BATCH-260929-07/ITM-1：与 S-3 V1 哈希一致，重复送达只留比对值', createdAt: '2026-09-29T15:50:00' },
  { id: 'A-5', claimId: '', action: '来源新版本收件', operator: '舆情回调', detail: 'BATCH-260929-07/ITM-2：social.example/post/9901 同址哈希变化，保留 V2', createdAt: '2026-09-29T15:52:00' },
  { id: 'A-6', claimId: 'FC-260929-01', action: '事实引用版本不确定', operator: '系统', detail: 'F-2 仅按地址引用，同址出现 V1/V2，发布前必须钉版', createdAt: '2026-09-29T15:52:00' },
  { id: 'A-7', claimId: '', action: '收件待核（缺哈希）', operator: '舆情回调', detail: 'BATCH-260929-07/ITM-3：缺少内容哈希，置待核', createdAt: '2026-09-29T17:05:00' },
  { id: 'A-8', claimId: '', action: '批次写入失败', operator: '系统', detail: 'BATCH-260929-07/ITM-5：存储超时，批次条目保留待恢复', createdAt: '2026-09-29T17:06:00' },
  { id: 'A-9', claimId: 'FC-260928-03', action: '发布锁定', operator: '宋卓', detail: 'V3 发布，冻结发布快照 SNAP-1', createdAt: '2026-09-30T10:00:00' },
  { id: 'A-10', claimId: '', action: '来源版本撤回', operator: '舆情回调', detail: 'C-2 监测记录撤回；FC-260928-03 已发布，快照仍可追', createdAt: '2026-10-02T09:30:00' }
]
