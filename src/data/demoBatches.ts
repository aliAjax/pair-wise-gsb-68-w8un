import type { IntakeBatchInput } from '../types'

/**
 * 舆情回调演示批次。每一批都可从“收件台”投递；写入失败的批次保留完整 payload，
 * 用“从批次恢复”只补未完成项。
 */

const stamp = (minute: number, second = 0) => `2026-10-05T09:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`

export function duplicateDeliveryBatch(): IntakeBatchInput {
  // 相同公开地址 + 相同哈希：舆情回调重复送同一篇报道，只留一条
  return {
    batchId: 'BATCH-DUP-01', source: '舆情监测回调', arrivedAt: stamp(1),
    items: [
      { itemId: 'CB-DUP-1', kind: 'news', title: '市供水水质周报', url: 'https://example.gov.cn/water/0928', publisher: '市水务局', publishedAt: '2026-09-28', evidenceKind: '原始证据', chainOfCustody: '回调去重演示：首送', contentHash: 'sha256:228a2...09cf', receivedAt: stamp(1, 1) },
      { itemId: 'CB-DUP-2', kind: 'news', title: '市供水水质周报', url: 'https://example.gov.cn/water/0928', publisher: '市水务局', publishedAt: '2026-09-28', evidenceKind: '原始证据', chainOfCustody: '回调去重演示：重复送同一篇', contentHash: 'sha256:228a2...09cf', receivedAt: stamp(1, 20) },
      { itemId: 'CB-DUP-3', kind: 'news', title: '市供水水质周报', url: 'https://example.gov.cn/water/0928', publisher: '市水务局', publishedAt: '2026-09-28', evidenceKind: '原始证据', chainOfCustody: '回调去重演示：第三次重复', contentHash: 'sha256:228a2...09cf', receivedAt: stamp(1, 45) }
    ]
  }
}

export function newHashBatch(): IntakeBatchInput {
  // 公开地址相同、内容哈希变化：保留两版；引用该地址但未钉住版本的事实标“引用不确定版本”
  return {
    batchId: 'BATCH-NEWHASH-01', source: '舆情监测回调', arrivedAt: stamp(5),
    items: [
      { itemId: 'CB-NH-1', kind: 'news', title: '储能电站消防设计审查公示（修订版）', url: 'https://example.gov.cn/fire/notice-77', publisher: '市住建委', publishedAt: '2026-10-05', evidenceKind: '原始证据', chainOfCustody: '同一公开地址推送了新内容，哈希与旧剪报不同', contentHash: 'sha256:a77e51...b80d', receivedAt: stamp(5, 3) },
      { itemId: 'CB-NH-2', kind: 'news', title: '储能电站消防设计审查公示（再次修订）', url: 'https://example.gov.cn/fire/notice-77', publisher: '市住建委', publishedAt: '2026-10-05', evidenceKind: '原始证据', chainOfCustody: '同页第三次改版，再保留一版', contentHash: 'sha256:33c902...f16a', receivedAt: stamp(5, 30) }
    ]
  }
}

export function dualCheckerBatch(): IntakeBatchInput {
  // 两名核查员同时提交同一来源版本：后到者只留比对值
  return {
    batchId: 'BATCH-DUAL-01', source: '核查员终端', arrivedAt: stamp(9),
    items: [
      { itemId: 'CB-DUAL-1', kind: 'news', title: '上游排口在线监测与执法巡查记录', url: 'https://example.gov.cn/env/0929', publisher: '市生态环境局', publishedAt: '2026-09-29', evidenceKind: '原始证据', chainOfCustody: '陆衡终端抓取并提交', contentHash: 'sha256:ab45d...9c31', checker: '陆衡', receivedAt: stamp(9, 2) },
      { itemId: 'CB-DUAL-2', kind: 'news', title: '上游排口在线监测与执法巡查记录', url: 'https://example.gov.cn/env/0929', publisher: '市生态环境局', publishedAt: '2026-09-29', evidenceKind: '原始证据', chainOfCustody: '顾薇终端同时提交，作为后到者只留比对值', contentHash: 'sha256:ab45d...9c31', checker: '顾薇', receivedAt: stamp(9, 4) }
    ]
  }
}

export function pendingHashBatch(): IntakeBatchInput {
  // 旧来源缺哈希：先待核，不能直接参与发布；随后补齐哈希升级为有效版本
  return {
    batchId: 'BATCH-PENDING-01', source: '舆情监测回调', arrivedAt: stamp(13),
    items: [
      { itemId: 'CB-PEN-1', kind: 'news', title: '储能系统负荷测算会议纪要（转载）', url: 'https://repost.example.net/load-memo', publisher: '行业转载号', publishedAt: '2026-10-04', evidenceKind: '待证信息', chainOfCustody: '旧来源回调无内容哈希，登记待核', contentHash: '', receivedAt: stamp(13, 5) }
    ]
  }
}

export function pendingHashUpgradeBatch(): IntakeBatchInput {
  return {
    batchId: 'BATCH-PENDING-02', source: '舆情监测回调', arrivedAt: stamp(21),
    items: [
      { itemId: 'CB-PEN-2', kind: 'news', title: '储能系统负荷测算会议纪要（原件）', url: 'https://repost.example.net/load-memo', publisher: '行业转载号', publishedAt: '2026-10-04', evidenceKind: '原始证据', chainOfCustody: '主管部门原件取回，哈希补齐', contentHash: 'sha256:8f21ba...7c4e', checker: '陆衡', receivedAt: stamp(21, 8), hashCompletion: true }
    ]
  }
}

export function writeFailureBatch(): IntakeBatchInput {
  // 三项一批，第二项模拟写入失败；恢复后仅补第二、三项
  return {
    batchId: 'BATCH-FAIL-01', source: '舆情监测回调', arrivedAt: stamp(26),
    items: [
      { itemId: 'CB-FAIL-1', kind: 'news', title: '市供水水质周报（专项复查）', url: 'https://example.gov.cn/water/1005', publisher: '市水务局', publishedAt: '2026-10-05', evidenceKind: '原始证据', chainOfCustody: '批次写入失败演示·第1项可落盘', contentHash: 'sha256:5b10df...2a77', receivedAt: stamp(26, 1) },
      { itemId: 'CB-FAIL-2', kind: 'news', title: '市供水水质周报（专项复查·附注）', url: 'https://example.gov.cn/water/1005', publisher: '市水务局', publishedAt: '2026-10-05', evidenceKind: '原始证据', chainOfCustody: '批次写入失败演示·第2项写入中断', contentHash: 'sha256:c94e20...6d03', receivedAt: stamp(26, 3), simulateWriteFailure: true },
      { itemId: 'CB-FAIL-3', kind: 'news', title: '管网末梢抽样检测结果', url: 'https://example.gov.cn/water/tap-1005', publisher: '市水务局', publishedAt: '2026-10-05', evidenceKind: '原始证据', chainOfCustody: '批次写入失败演示·第3项恢复后补写', contentHash: 'sha256:0e77ad...9b21', receivedAt: stamp(26, 5) }
    ]
  }
}

export function retractionBatch(): IntakeBatchInput {
  // 撤回件到达：依赖该版的未发布结论失效重算
  return {
    batchId: 'BATCH-RETRACT-01', source: '舆情监测回调·撤回通道', arrivedAt: stamp(31),
    items: [
      { itemId: 'CB-RET-1', kind: 'retraction', url: 'https://social.example/post/9901', refHash: 'sha256:1fe210...67bd', reason: '原帖发布者声明截图系拼接，主动删帖并撤回', receivedAt: stamp(31, 2) },
      { itemId: 'CB-RET-1DUP', kind: 'retraction', url: 'https://social.example/post/9901', refHash: 'sha256:1fe210...67bd', reason: '撤回通道重复推送同一撤回件', receivedAt: stamp(31, 9) }
    ]
  }
}

export function publishedRetractionBatch(): IntakeBatchInput {
  // 对已发布主张的来源版本下撤回：结论不动，快照标记仍可追
  return {
    batchId: 'BATCH-PUBRET-01', source: '舆情监测回调·撤回通道', arrivedAt: stamp(40),
    items: [
      { itemId: 'CB-PRET-1', kind: 'retraction', url: 'https://example.gov.cn/water/0928', refHash: 'sha256:228a2...09cf', reason: '水务局勘误水质周报并撤回原版本', receivedAt: stamp(40, 4) }
    ]
  }
}
