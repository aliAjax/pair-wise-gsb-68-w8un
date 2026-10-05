import { Badge, Box, Button, Flex, Text, useToast } from '@chakra-ui/react'
import { useClaimStore } from '../store/useClaimStore'
import { preflightPublish } from '../services/chains'

export function ReviewQueue() {
  const state = useClaimStore()
  const toast = useToast()
  const reviewClaims = state.claims.filter((claim) => claim.status === '待编辑复核' || claim.facts.some((fact) => fact.annotations.some((note) => !note.resolved)))
  const approve = (claimId: string) => {
    const result = state.transitionClaim(claimId, '已发布', '编辑完成事实、来源与相反证据复核，全部引用钉版。')
    toast({ title: result.message, status: result.ok ? 'success' : 'error', duration: 4000 })
  }
  return <Box p="6" pb="16">
    <Box mb="5"><Text fontSize="xs" color="gray.600">编辑审阅 / 争议证据 / 发布前检查</Text><Text fontSize="xl" fontWeight="700" mt="1">复核队列</Text><Text fontSize="sm" color="gray.600" mt="1">发布校验接入收件链：待核（缺哈希）、已撤回、断链、引用版本不确定、撤回后失效待重算的事实一律阻断。</Text></Box>
    <Flex direction="column" gap="3">{reviewClaims.map((claim) => {
      const unresolved = claim.facts.flatMap((fact) => fact.annotations.filter((note) => !note.resolved).map((note) => ({ fact, note })))
      const preflight = preflightPublish(state.registry, claim)
      return <Box key={claim.id} bg="white" borderWidth="1px" p="4">
        <Flex justify="space-between"><Box><Text fontFamily="mono" fontSize="xs" color="gray.500">{claim.id}</Text><Text fontWeight="700" mt="1">{claim.title}</Text></Box><Badge colorScheme="orange">{claim.status}</Badge></Flex>
        <Flex mt="4" gap="4">
          <Box flex="1"><Text fontSize="sm" fontWeight="600">未解决批注 {unresolved.length}</Text>{unresolved.map(({ fact, note }) => <Box key={note.id} bg={note.role === '系统' ? 'purple.50' : 'orange.50'} p="2" mt="2"><Text fontSize="xs" color="gray.500">{fact.id} · {note.role}{note.author}</Text><Text fontSize="sm">{note.content}</Text></Box>)}</Box>
          <Box flex="1"><Text fontSize="sm" fontWeight="600">发布阻断 {preflight.blocking.length}</Text>{preflight.blocking.map((item) => <Box key={item} bg="red.50" p="2" mt="2"><Text fontSize="sm">{item}</Text></Box>)}{preflight.warnings.map((item) => <Box key={item} bg="yellow.50" p="2" mt="2"><Text fontSize="xs" color="gray.700">提醒：{item}</Text></Box>)}</Box>
        </Flex>
        {preflight.blocking.length > 0 && <Button mt="4" size="sm" colorScheme="teal" isDisabled onClick={() => approve(claim.id)}>发布前校验未通过（{preflight.blocking.length} 项）</Button>}
        {preflight.blocking.length === 0 && <Button mt="4" size="sm" colorScheme="teal" onClick={() => approve(claim.id)}>批准发布并冻结快照</Button>}
      </Box>
    })}</Flex>
  </Box>
}
