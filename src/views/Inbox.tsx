import { useState } from 'react'
import {
  Badge, Box, Button, Divider, Flex, Grid, GridItem, Input, Stack, Table, Tbody, Td, Text, Th, Thead, Tr, useToast,
} from '@chakra-ui/react'
import { useClaimStore } from '../store/useClaimStore'
import { batchIsRecoverable, versionsOf } from '../services/chains'
import type { IngestItemInput, IntakeItemStatus, SourceState, SourceVersion } from '../types'

const statusColor: Record<IntakeItemStatus, string> = {
  已完成: 'green',
  已去重: 'cyan',
  待核: 'orange',
  已撤回生效: 'purple',
  已失效重算: 'red',
  撤回未匹配: 'yellow',
  写入失败: 'red',
  待处理: 'gray',
}

const stateColor: Record<SourceState, string> = { 已核验: 'green', 待核: 'orange', 已撤回: 'red' }

export function Inbox() {
  const state = useClaimStore()
  const toast = useToast()
  const [verifyHash, setVerifyHash] = useState<Record<string, string>>({})
  const [retractReason, setRetractReason] = useState('')

  const run = (label: string, channel: string, inputs: IngestItemInput[], failIndex?: number) => {
    state.ingestChannelBatch(channel, inputs, failIndex)
    toast({ title: `${label}：批次已入链`, status: 'success', duration: 2600 })
  }

  const scenarios = [
    {
      label: '回调：重复推送 + 内容改版',
      desc: '同址同哈希只留比对值；同址新哈希保留 V3 并把未钉版事实标为版本不确定',
      onClick: () => run('重复/改版批次', '舆情回调 / 报道更新', [
        { kind: '回调送达', url: 'https://social.example/post/9901', title: '匿名用户上传的验收文件局部截图（首版重推）', publisher: '社交平台账号', publishedAt: '2026-10-05T08:00:00', contentHash: 'sha256:1fe210...67bd', evidenceKind: '待证信息', chainOfCustody: '回调重复推送同一篇报道', submitter: '舆情回调' },
        { kind: '回调送达', url: 'https://social.example/post/9901', title: '匿名截图（平台二次编辑）', publisher: '社交平台账号', publishedAt: '2026-10-05T08:20:00', contentHash: 'sha256:2c77e1...55ab', evidenceKind: '待证信息', chainOfCustody: '同址第三版，正文再改，与 V1/V2 并存', claimId: 'FC-260929-01', factId: 'F-2', submitter: '舆情回调' },
      ]),
    },
    {
      label: '两名核查员并发提交同版',
      desc: '同址同哈希：先到建卡钉版，后到只留比对值',
      onClick: () => run('并发同版批次', '舆情回调 / 人工提交', [
        { kind: '回调送达', url: 'https://example.gov.cn/notice/77', title: '主管部门关于应急电源方案的情况说明', publisher: '市发展改革委', publishedAt: '2026-10-05', contentHash: 'sha256:aa01ff...9e21', evidenceKind: '原始证据', chainOfCustody: '核查员陆衡抓取', claimId: 'FC-260929-01', factId: 'F-2', submitter: '陆衡', origin: '人工' },
        { kind: '回调送达', url: 'https://example.gov.cn/notice/77', title: '主管部门关于应急电源方案的情况说明', publisher: '市发展改革委', publishedAt: '2026-10-05', contentHash: 'sha256:aa01ff...9e21', evidenceKind: '原始证据', chainOfCustody: '核查员沈言同时抓取', claimId: 'FC-260929-01', factId: 'F-2', submitter: '沈言', origin: '人工' },
      ]),
    },
    {
      label: '撤回：未发布依赖失效重算',
      desc: '撤回环评 V1 哈希，未发布且钉该版的 F-1 结论失效并退回核查中',
      onClick: () => run('撤回批次', '舆情回调 / 撤回通道', [
        { kind: '撤回件', url: 'https://example.gov.cn/report/2025-1102', title: '一期工程环境影响报告表', publisher: '市生态环境局', publishedAt: '2025-11-02', contentHash: 'sha256:9d31f1...a42c', evidenceKind: '原始证据', chainOfCustody: '官网公告该报告表版次作废，以新批复为准', submitter: '撤回通道' },
      ]),
    },
    {
      label: '撤回：已发布主张只追快照',
      desc: '再次撤回 C-2 哈希：已发布主张不重算，SNAP-1 仍冻结已核验状态',
      onClick: () => run('重复撤回批次', '舆情回调 / 撤回通道', [
        { kind: '撤回件', url: 'https://example.gov.cn/env/0929', title: '上游排口在线监测与执法巡查记录', publisher: '市生态环境局', publishedAt: '2026-09-29', contentHash: 'sha256:ab45d...9c31', evidenceKind: '原始证据', chainOfCustody: '撤回通知重复送达', submitter: '撤回通道' },
      ]),
    },
    {
      label: '缺哈希旧报道：先待核',
      desc: '回调没有内容哈希，登记为待核，不能参与发布',
      onClick: () => run('缺哈希批次', '舆情回调 / 报道更新', [
        { kind: '回调送达', url: 'https://social.example/post/8810', title: '转引的验收通稿（无哈希）', publisher: '某资讯号', publishedAt: '2026-10-05', contentHash: '', evidenceKind: '待证信息', chainOfCustody: '回调载荷缺少正文哈希字段', submitter: '舆情回调' },
      ]),
    },
    {
      label: '含写入失败的批次',
      desc: '第 3 项模拟存储超时；批次完整保留，点“恢复批次”只补未完成项',
      onClick: () => run('失败批次', '舆情回调 / 报道更新', [
        { kind: '回调送达', url: 'https://example.com/tender/8821', title: '项目设备采购公告（重推）', publisher: '公共资源交易平台', publishedAt: '2026-01-18', contentHash: 'sha256:7bc029...de10', evidenceKind: '原始证据', chainOfCustody: '同哈希重推，应只留比对值', submitter: '舆情回调' },
        { kind: '回调送达', url: 'https://vendor.example/white-paper', title: '设备厂商技术白皮书（补哈希）', publisher: '设备厂商', publishedAt: '2026-05-12', contentHash: 'sha256:6a8d22...41ee', evidenceKind: '二次来源', chainOfCustody: '补算白皮书哈希后重新推送', submitter: '舆情回调' },
        { kind: '回调送达', url: 'https://example.com/meeting/minutes-18', title: '监理例会纪要（恢复项）', publisher: '项目监理单位', publishedAt: '2026-10-05', contentHash: 'sha256:7e91d0...c408', evidenceKind: '原始证据', chainOfCustody: '首次写入超时，恢复时只补本项', claimId: 'FC-260929-01', factId: 'F-3', submitter: '舆情回调' },
      ], 2),
    },
  ]

  // 台账按公开地址归并
  const groups = Array.from(new Set(state.registry.map((item) => item.urlKey)))
    .map((urlKey) => ({ urlKey, versions: versionsOf(state.registry, urlKey) }))
    .sort((a, b) => a.urlKey.localeCompare(b.urlKey))

  return <Box p="6" pb="16">
    <Box mb="5">
      <Text fontSize="xs" color="gray.600">舆情回调 / 来源台账 / 批次恢复 / 撤回传播</Text>
      <Text fontSize="xl" fontWeight="700" mt="1">舆情收件链</Text>
      <Text fontSize="sm" color="gray.600" mt="1">收件以「公开地址 + 内容哈希」归并：同哈希只留一条，不同哈希并列保留多版；撤回按哈希命中并传播到未发布结论；写入失败可从完整批次只补未完成项。</Text>
    </Box>

    <Grid templateColumns="repeat(3,1fr)" bg="white" borderWidth="1px" mb="4">
      {[
        ['收件批次', state.batches.length, `${state.batches.filter((batch) => !batch.complete).length} 个含未完成项`],
        ['来源版本', state.registry.length, `公开地址 ${groups.length} 个`],
        ['发布快照', state.snapshots.length, '撤回后仍可追溯'],
      ].map(([label, value, note]) => <GridItem key={String(label)} p="4" borderRightWidth="1px">
        <Text fontSize="xs" color="gray.600">{label}</Text>
        <Text fontSize="2xl" fontWeight="700" color="brand.700" my="1">{value}</Text>
        <Text fontSize="xs" color="gray.500">{note}</Text>
      </GridItem>)}
    </Grid>

    <Box bg="white" borderWidth="1px" p="4" mb="4">
      <Text fontWeight="700" mb="1">模拟收件批次</Text>
      <Text fontSize="xs" color="gray.500" mb="3">每批条目原始载荷完整保留；终态（已完成/已去重/待核/撤回生效/失效重算/撤回未匹配）在恢复时不重复处理。</Text>
      <Grid templateColumns="repeat(3,1fr)" gap="3">
        {scenarios.map((item) => <Box key={item.label} borderWidth="1px" p="3">
          <Text fontSize="sm" fontWeight="700">{item.label}</Text>
          <Text fontSize="xs" color="gray.600" mt="1" minH="32px">{item.desc}</Text>
          <Button size="xs" mt="2" colorScheme="teal" variant="outline" onClick={item.onClick}>送入一批</Button>
        </Box>)}
      </Grid>
    </Box>

    <Box bg="white" borderWidth="1px" p="4" mb="4">
      <Text fontWeight="700" mb="3">收件批次与恢复</Text>
      <Stack spacing="3">
        {state.batches.map((batch) => <Box key={batch.batchId} borderWidth="1px" p="3">
          <Flex justify="space-between" align="center">
            <Box>
              <Text fontFamily="mono" fontSize="xs" color="gray.500">{batch.batchId} · {batch.channel}</Text>
              <Text fontSize="xs" color="gray.500" mt="1">收件 {fmt(batch.receivedAt)}{batch.appliedAt ? ` · 结清 ${fmt(batch.appliedAt)}` : ''} · 尝试 {batch.items.reduce((sum, item) => sum + item.attempts, 0)} 次</Text>
            </Box>
            <Flex gap="2" align="center">
              <Badge colorScheme={batch.complete ? 'green' : 'red'}>{batch.complete ? '批次结清' : '含未完成项'}</Badge>
              {batchIsRecoverable(batch) && <Button size="xs" colorScheme="orange" onClick={() => {
                const result = state.recoverBatch(batch.batchId)
                toast({ title: result.message, status: result.ok ? 'success' : 'error', duration: 3200 })
              }}>从完整批次恢复（只补未完成项）</Button>}
            </Flex>
          </Flex>
          <Table size="sm" mt="2">
            <Thead><Tr><Th>条目</Th><Th>类型</Th><Th>公开地址 / 哈希</Th><Th>状态</Th><Th>比对结果</Th></Tr></Thead>
            <Tbody>{batch.items.map((item) => <Tr key={item.itemId}>
              <Td fontSize="xs" fontFamily="mono">{item.itemId}<Text color="gray.400">{item.submitter}</Text></Td>
              <Td><Badge variant="outline">{item.kind}</Badge></Td>
              <Td fontSize="xs" wordBreak="break-all">{item.url.replace(/^https?:\/\//, '')}<Text fontFamily="mono" color={item.contentHash ? 'gray.600' : 'red.500'}>{item.contentHash || '（无哈希）'}</Text></Td>
              <Td><Badge colorScheme={statusColor[item.status]}>{item.status}</Badge></Td>
              <Td fontSize="xs" color="gray.600">{item.resultNote}</Td>
            </Tr>)}</Tbody>
          </Table>
        </Box>)}
      </Stack>
    </Box>

    <Box bg="white" borderWidth="1px" p="4">
      <Text fontWeight="700" mb="1">来源版本台账</Text>
      <Text fontSize="xs" color="gray.500" mb="3">同一公开地址下多版并列；事实只按地址引用且存在多版时，必须在核查工作区钉住确定版本后才能发布。</Text>
      <Stack spacing="3">
        {groups.map((group) => <Box key={group.urlKey} borderWidth="1px" p="3">
          <Flex justify="space-between" align="center">
            <Text fontSize="sm" fontWeight="700" wordBreak="break-all">{group.urlKey}</Text>
            <Badge>{group.versions.length} 版</Badge>
          </Flex>
          {group.versions.map((source: SourceVersion) => <Box key={source.id} mt="2" pl="3" borderLeftWidth="3px" borderColor={source.state === '已撤回' ? 'red.300' : source.state === '待核' ? 'orange.300' : 'green.300'}>
            <Flex justify="space-between" align="center" wrap="wrap" gap="2">
              <Box>
                <Flex gap="2" align="center">
                  <Text fontSize="sm" fontWeight="600">{source.title}</Text>
                  <Badge colorScheme={stateColor[source.state]}>{source.state}</Badge>
                  <Badge variant="outline">V{source.versionNo}</Badge>
                  <Badge variant="outline" colorScheme="gray">{source.origin}</Badge>
                </Flex>
                <Text fontFamily="mono" fontSize="xs" mt="1">{source.contentHash || '无哈希'}</Text>
                <Text fontSize="xs" color="gray.500">{source.publisher} · 发布 {source.publishedAt} · 收件 {fmt(source.receivedAt)}{source.retractedAt ? ` · 撤回 ${fmt(source.retractedAt)}` : ''}</Text>
              </Box>
              <Flex gap="2" align="center">
                {source.state === '待核' && <>
                  <Input size="xs" w="210px" placeholder="补算内容哈希 sha256:..." value={verifyHash[source.id] ?? ''} onChange={(event) => setVerifyHash((map) => ({ ...map, [source.id]: event.target.value }))} />
                  <Button size="xs" colorScheme="orange" onClick={() => {
                    const result = state.verifySourceHash(source.id, verifyHash[source.id] ?? '')
                    toast({ title: result.message, status: result.ok ? 'success' : 'warning', duration: 3000 })
                  }}>补哈希核验</Button>
                </>}
                {source.state === '已核验' && <Button size="xs" colorScheme="red" variant="outline" onClick={() => state.retractSource(source.id, retractReason || '撤回通道手工登记：内容有误')} >登记撤回</Button>}
              </Flex>
            </Flex>
            <Text fontSize="xs" color="gray.600" mt="1">{source.chainOfCustody}</Text>
            <Divider my="1" />
          </Box>)}
        </Box>)}
      </Stack>
      <Input mt="3" size="sm" maxW="520px" placeholder="撤回原因（可选，随撤回件写入保管链）" value={retractReason} onChange={(event) => setRetractReason(event.target.value)} />
    </Box>
  </Box>
}

function fmt(value: string): string {
  return value.replace('T', ' ').slice(0, 16)
}
