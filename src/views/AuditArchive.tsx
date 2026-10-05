import { useState } from 'react'
import { Badge, Box, Button, Flex, Grid, GridItem, Input, Table, Tbody, Td, Text, Th, Thead, Tr } from '@chakra-ui/react'
import { useClaimStore } from '../store/useClaimStore'

export function AuditArchive() {
  const state = useClaimStore()
  const [keyword, setKeyword] = useState('')
  const rows = state.audit.filter((item) => `${item.claimId} ${item.action} ${item.operator} ${item.detail}`.toLowerCase().includes(keyword.toLowerCase()))
  const exportAll = () => {
    const payload = { generatedAt: new Date().toISOString(), claims: state.claims, registry: state.registry, batches: state.batches, snapshots: state.snapshots, versions: state.versions, audit: state.audit }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = '事实核查收件链档案与审计.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  return <Box p="6" pb="16">
    <Flex justify="space-between" align="center" mb="5"><Box><Text fontSize="xs" color="gray.600">主张 / 收件批次 / 证据版本 / 批注 / 发布快照</Text><Text fontSize="xl" fontWeight="700" mt="1">核查档案与审计</Text></Box><Button colorScheme="teal" onClick={exportAll}>导出全部档案</Button></Flex>

    <Box bg="white" borderWidth="1px" p="4" mb="4">
      <Text fontWeight="700" mb="3">发布快照（不可变，撤回后仍可追）</Text>
      <Grid templateColumns="repeat(2,1fr)" gap="3">
        {state.snapshots.length === 0 && <Text fontSize="xs" color="gray.500">尚无发布快照</Text>}
        {state.snapshots.map((snapshot) => {
          const live = state.registry
          const changedAfter = snapshot.factDigests.flatMap((digest) => digest.refs.filter((ref) => {
            const now = live.find((item) => item.id === ref.sourceId)
            return now && now.state !== ref.state
          }).map((ref) => ({ digest, ref, now: live.find((item) => item.id === ref.sourceId)! })))
          return <GridItem key={snapshot.id} borderWidth="1px" p="3">
            <Flex justify="space-between"><Text fontFamily="mono" fontSize="xs" color="gray.500">{snapshot.id} · {snapshot.claimId}</Text><Badge colorScheme="green">V{snapshot.claimVersion} 已冻结</Badge></Flex>
            <Text fontSize="sm" fontWeight="700" mt="1">{snapshot.title}</Text>
            <Text fontSize="xs" color="gray.600" mt="1">{snapshot.publishedAt.replace('T', ' ').slice(0, 16)} · 编辑 {snapshot.editor}</Text>
            {snapshot.factDigests.map((digest) => <Box key={digest.factId} mt="2">
              <Text fontSize="xs" fontWeight="700">{digest.factId}：{digest.text} → {digest.conclusion}（{digest.confidence}%）</Text>
              {digest.refs.map((ref) => <Text key={ref.sourceId + ref.counter} fontSize="xs" fontFamily="mono" color="gray.600" mt="0.5">{ref.counter ? '[反证]' : '[支持]'} {ref.title} · {ref.hash} · 冻结时：{ref.state}</Text>)}
            </Box>)}
            {changedAfter.length > 0 && <Box bg="red.50" p="2" mt="2"><Text fontSize="xs" fontWeight="700" color="red.700">发布后发生变更（快照不动，仍按冻结值追溯）：</Text>{changedAfter.map(({ ref, now }) => <Text key={ref.sourceId} fontSize="xs" color="red.700">· {ref.title} 台账当前为「{now.state}」，快照仍为「{ref.state}」</Text>)}</Box>}
          </GridItem>
        })}
      </Grid>
    </Box>

    <Flex gap="3" mb="3"><Input maxW="460px" placeholder="搜索主张、动作、操作人或说明" value={keyword} onChange={(event) => setKeyword(event.target.value)} /><Text alignSelf="center" fontSize="xs" color="gray.500">共{rows.length}条不可变审计事件（含收件通道事件）</Text></Flex>
    <Box bg="white" borderWidth="1px"><Table size="sm"><Thead><Tr><Th>时间</Th><Th>主张</Th><Th>动作</Th><Th>操作人</Th><Th>说明</Th></Tr></Thead><Tbody>{rows.map((item) => <Tr key={item.id}><Td fontSize="xs">{item.createdAt.replace('T', ' ').slice(0, 16)}</Td><Td fontFamily="mono" fontSize="xs">{item.claimId || <Badge variant="outline" colorScheme="purple">收件通道</Badge>}</Td><Td><Badge colorScheme={item.action.includes('撤回') || item.action.includes('失效') ? 'red' : item.action.includes('去重') ? 'cyan' : item.action.includes('待核') ? 'orange' : item.action.includes('发布') || item.action.includes('重算') ? 'green' : 'blue'}>{item.action}</Badge></Td><Td>{item.operator}</Td><Td fontSize="sm">{item.detail}</Td></Tr>)}</Tbody></Table></Box>
    <Box mt="5" bg="white" borderWidth="1px" p="4"><Text fontWeight="700">收件链留痕原则</Text><Text fontSize="sm" color="gray.600" mt="2">相同内容哈希只留一条并留存比对值；同址不同哈希并列保留，事实引用须钉版；撤回件按哈希命中，未发布依赖结论失效重算，已发布快照冻结可追；收件失败保留完整批次，恢复只补未完成项；旧来源缺哈希先待核，不得发布。</Text></Box>
  </Box>
}
