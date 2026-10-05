import { useState } from 'react'
import { Badge, Box, Button, Divider, Flex, Grid, GridItem, Text, useToast } from '@chakra-ui/react'
import { useClaimStore } from '../store/useClaimStore'
import {
  dualCheckerBatch, duplicateDeliveryBatch, newHashBatch, pendingHashBatch, pendingHashUpgradeBatch,
  publishedRetractionBatch, retractionBatch, writeFailureBatch
} from '../data/demoBatches'
import type { IntakeBatchInput, SourceVersion } from '../types'

const statusColor: Record<SourceVersion['status'], string> = { 待核: 'orange', 有效: 'green', 已撤回: 'red' }
const resultColor: Record<string, string> = {
  deduped: 'gray', registered: 'green', 'new-version': 'purple', 'verification-only': 'cyan',
  'pending-hash': 'orange', 'hash-upgraded': 'teal', retracted: 'red', 'retraction-deduped': 'gray',
  'retraction-target-missing': 'orange'
}

const SCENARIOS: Array<{ key: string; label: string; desc: string; build: () => IntakeBatchInput }> = [
  { key: 'dup', label: '重复回调同篇报道', desc: '同地址同哈希连送3次，只留一条，receiptCount 累加', build: duplicateDeliveryBatch },
  { key: 'newhash', label: '同地址内容改版×2', desc: '哈希变化保留两版，F-3 的未钉版剪报被标“引用不确定版本”', build: newHashBatch },
  { key: 'dual', label: '两核查员同版本并发', desc: '陆衡先到登记，顾薇后到只留比对值（matched=true）', build: dualCheckerBatch },
  { key: 'pending', label: '旧来源缺哈希', desc: '先待核，发布校验拦截；不自动关联任何事实', build: pendingHashBatch },
  { key: 'upgrade', label: '待核件补齐哈希', desc: '待核条目升级为有效版本并回填核验', build: pendingHashUpgradeBatch },
  { key: 'fail', label: '批次写入失败', desc: '第2项中断，第1项落盘；完整批次保留', build: writeFailureBatch },
  { key: 'retract', label: '撤回件（未发布主张）', desc: 'F-2 引用版本撤回：结论失效置证据不足，强制重算', build: retractionBatch },
  { key: 'pubret', label: '撤回件（已发布主张）', desc: '需先在复核队列发布 FC-260928-03；快照标记、内容不变仍可追', build: publishedRetractionBatch }
]

export function IntakeConsole() {
  const state = useClaimStore()
  const toast = useToast()
  const [expanded, setExpanded] = useState<string | null>('batches')

  const deliver = (build: () => IntakeBatchInput) => {
    const input = build()
    const result = state.ingestBatch(input)
    toast({ title: result.message, status: result.ok ? 'success' : 'warning', duration: 4200 })
  }
  const recover = (batchId: string) => {
    const result = state.recoverBatch(batchId)
    toast({ title: result.message, status: result.ok ? 'success' : 'error', duration: 4200 })
  }

  const groups = new Map<string, SourceVersion[]>()
  for (const entry of state.sourceRegistry) {
    groups.set(entry.key, [...(groups.get(entry.key) ?? []), entry])
  }

  return <Box p="6" pb="16">
    <Box mb="5"><Text fontSize="xs" color="gray.600">舆情回调 / 内容哈希 / 撤回通道 / 写入恢复</Text><Text fontSize="xl" fontWeight="700" mt="1">收件台 · 可核验收件链</Text>
      <Text fontSize="sm" color="gray.600" mt="1">规则：相同哈希只留一条；不同哈希同址保留多版；缺哈希先待核不得发布；撤回件只令未发布结论失效重算，已发布快照永久可追。</Text>
    </Box>

    <Grid templateColumns="1fr 1fr" gap="4" mb="5">
      <GridItem bg="white" borderWidth="1px" p="4">
        <Text fontWeight="700" mb="3">模拟舆情回调批次</Text>
        <Flex direction="column" gap="2">
          {SCENARIOS.map((scenario) => <Flex key={scenario.key} justify="space-between" align="center" borderWidth="1px" p="2" borderRadius="4">
            <Box><Text fontSize="sm" fontWeight="600">{scenario.label}</Text><Text fontSize="xs" color="gray.500">{scenario.desc}</Text></Box>
            <Button size="xs" colorScheme="teal" onClick={() => deliver(scenario.build)}>投递</Button>
          </Flex>)}
        </Flex>
      </GridItem>
      <GridItem bg="white" borderWidth="1px" p="4">
        <Flex justify="space-between" mb="3"><Text fontWeight="700">收件批次（{state.intakeBatches.length}）</Text><Button size="xs" variant="ghost" onClick={() => setExpanded(expanded === 'batches' ? null : 'batches')}>{expanded === 'batches' ? '收起' : '展开'}</Button></Flex>
        <Box maxH="430px" overflowY="auto">
          {state.intakeBatches.length === 0 && <Text fontSize="sm" color="gray.500">尚无批次，从左侧投递模拟回调。</Text>}
          {state.intakeBatches.map((batch) => <Box key={batch.id} borderWidth="1px" p="2" mb="2">
            <Flex justify="space-between" align="center">
              <Box><Text fontFamily="mono" fontSize="xs">{batch.id} · {batch.source}</Text><Text fontSize="xs" color="gray.500">到达 {batch.arrivedAt.replace('T', ' ').slice(0, 16)} · {batch.items.length} 项 / 已回执 {batch.receipts.length}</Text></Box>
              <Badge colorScheme={batch.status === '已处理' ? 'green' : 'red'}>{batch.status}</Badge>
            </Flex>
            {batch.error && <Text fontSize="xs" color="red.600" mt="1">{batch.error}</Text>}
            {batch.status === '部分失败' && <Button size="xs" mt="2" colorScheme="orange" onClick={() => recover(batch.id)}>从完整批次恢复（只补未完成项）</Button>}
            {expanded === 'batches' && <Box mt="2">
              {batch.items.map((item) => {
                const receipt = batch.receipts.find((record) => record.itemId === item.itemId)
                return <Flex key={item.itemId} justify="space-between" fontSize="xs" py="1" borderTopWidth="1px" borderColor="gray.100">
                  <Text fontFamily="mono">{item.itemId}{item.simulateWriteFailure && ' ⚠写入失败'}</Text>
                  {receipt ? <Badge colorScheme={resultColor[receipt.result]}>{receipt.result}</Badge> : <Badge colorScheme="red">未完成</Badge>}
                </Flex>
              })}
            </Box>}
          </Box>)}
        </Box>
      </GridItem>
    </Grid>

    <Box bg="white" borderWidth="1px" p="4" mb="5">
      <Text fontWeight="700" mb="1">来源版本库</Text>
      <Text fontSize="xs" color="gray.500" mb="3">同一公开地址下按内容哈希分行保留；核查员比对值挂在版本上，不另建卡片。</Text>
      <Flex direction="column" gap="3">
        {[...groups.entries()].map(([key, entries]) => <Box key={key} borderWidth="1px" p="3">
          <Text fontSize="xs" color="blue.700" wordBreak="break-all">{key}</Text>
          <Flex direction="column" gap="2" mt="2">
            {entries.map((entry) => <Flex key={entry.contentHash || 'pending'} justify="space-between" align="flex-start" gap="3" bg={entry.status === '已撤回' ? 'red.50' : entry.status === '待核' ? 'orange.50' : 'gray.50'} p="2">
              <Box>
                <Flex gap="2" align="center"><Text fontSize="sm" fontWeight="600">{entry.title}</Text><Badge colorScheme={statusColor[entry.status]}>{entry.status}</Badge>{entries.length > 1 && <Badge colorScheme="purple">{entries.length} 版并存</Badge>}</Flex>
                <Text fontFamily="mono" fontSize="xs" mt="1">{entry.contentHash || '（缺哈希·待核）'}</Text>
                <Text fontSize="xs" color="gray.500" mt="1">{entry.publisher} · 发布 {entry.publishedAt} · 首收 {entry.firstReceivedAt.replace('T', ' ').slice(0, 16)} · 回调 {entry.receiptCount} 次</Text>
                {entry.verifications.length > 0 && <Box mt="1">{entry.verifications.map((verification) => <Text key={`${verification.checker}-${verification.receivedAt}`} fontSize="xs"><Badge colorScheme={verification.matched ? 'cyan' : 'red'} mr="1">{verification.matched ? '比对一致' : '比对不一致'}</Badge>{verification.checker} · {verification.note} · {verification.receivedAt.replace('T', ' ').slice(11, 16)}</Text>)}</Box>}
                {entry.retractedAt && <Text fontSize="xs" color="red.600" mt="1">撤回于 {entry.retractedAt.replace('T', ' ').slice(0, 16)}（撤回件 {entry.retractedBy}）</Text>}
              </Box>
              <Text fontSize="xs" color="gray.500" maxW="280px">{entry.chainOfCustody}</Text>
            </Flex>)}
          </Flex>
        </Box>)}
      </Flex>
    </Box>

    <Box bg="white" borderWidth="1px" p="4">
      <Text fontWeight="700" mb="3">发布快照（{state.publishedSnapshots.length}）</Text>
      {state.publishedSnapshots.length === 0 && <Text fontSize="sm" color="gray.500">尚无已发布快照。发布 FC-260928-03 后再投递“撤回件（已发布主张）”即可观察快照追踪。</Text>}
      {state.publishedSnapshots.map((snapshot) => <Box key={snapshot.id} borderWidth="1px" p="3" mb="2">
        <Flex justify="space-between">
          <Box><Text fontWeight="700" fontSize="sm">{snapshot.claimTitle}</Text><Text fontFamily="mono" fontSize="xs" color="gray.500">{snapshot.id} · {snapshot.claimId} V{snapshot.version} · 发布 {snapshot.publishedAt.replace('T', ' ').slice(0, 16)} · 锁定人 {snapshot.editor}</Text></Box>
          <Badge colorScheme={snapshot.status === '发布有效' ? 'green' : 'red'}>{snapshot.status}</Badge>
        </Flex>
        <Text fontSize="xs" color="gray.600" mt="2">{snapshot.note}</Text>
        {snapshot.retractedHashes.length > 0 && <Box mt="2">{snapshot.retractedHashes.map((hash) => <Text key={hash} fontFamily="mono" fontSize="xs" color="red.600">撤回哈希追踪：{hash}（快照内容不变，仍可逐版追溯）</Text>)}</Box>}
        <Divider my="2" />
        <Text fontSize="xs" color="gray.500">快照锁定事实 {snapshot.claim.facts.length} 项、来源版本 {snapshot.claim.facts.flatMap((fact) => [...fact.sources, ...fact.counterSources]).length} 条（深拷贝独立于工作稿）。</Text>
      </Box>)}
    </Box>
  </Box>
}
