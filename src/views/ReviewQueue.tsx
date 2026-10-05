import { Badge, Box, Button, Flex, Text, useToast } from '@chakra-ui/react'
import { publishGate } from '../services/intakeChain'
import { useClaimStore } from '../store/useClaimStore'

export function ReviewQueue() {
  const state = useClaimStore()
  const toast = useToast()
  const reviewClaims = state.claims.filter((claim) => claim.status === '待编辑复核' || claim.facts.some((fact) => fact.annotations.some((note) => !note.resolved)))
  const approve = (claimId: string) => {
    const result = state.transitionClaim(claimId, '已发布', '编辑完成事实、来源版本钉住与相反证据复核。')
    toast({ title: result.message, status: result.ok ? 'success' : 'error', duration: 5000 })
  }
  return <Box p="6" pb="16">
    <Box mb="5"><Text fontSize="xs" color="gray.600">编辑审阅 / 争议证据 / 发布前检查</Text><Text fontSize="xl" fontWeight="700" mt="1">复核队列</Text></Box>
    <Flex direction="column" gap="3">{reviewClaims.map((claim) => {
      const unresolved = claim.facts.flatMap((fact) => fact.annotations.filter((note) => !note.resolved).map((note) => ({ fact, note })))
      const blockingFacts = claim.facts.filter((fact) => fact.conclusion === '证据不足' && fact.unresolved.length)
      const chainBlocking = publishGate(claim)
      const blocked = blockingFacts.length > 0 || chainBlocking.length > 0
      return <Box key={claim.id} bg="white" borderWidth="1px" p="4">
        <Flex justify="space-between"><Box><Text fontFamily="mono" fontSize="xs" color="gray.500">{claim.id}</Text><Text fontWeight="700" mt="1">{claim.title}</Text></Box><Badge colorScheme="orange">{claim.status}</Badge></Flex>
        <Flex mt="4" gap="4">
          <Box flex="1"><Text fontSize="sm" fontWeight="600">未解决批注 {unresolved.length}</Text>{unresolved.map(({ fact, note }) => <Box key={note.id} bg="orange.50" p="2" mt="2"><Text fontSize="xs" color="gray.500">{fact.id} · {note.role} {note.author}</Text><Text fontSize="sm">{note.content}</Text></Box>)}</Box>
          <Box flex="1"><Text fontSize="sm" fontWeight="600">结论阻断 {blockingFacts.length}</Text>{blockingFacts.map((fact) => <Box key={fact.id} bg="red.50" p="2" mt="2"><Text fontSize="xs" color="gray.500">{fact.id}</Text><Text fontSize="sm">{fact.unresolved.join('；')}</Text></Box>)}</Box>
          <Box flex="1"><Text fontSize="sm" fontWeight="600">收件链阻断 {chainBlocking.length}</Text>{chainBlocking.map((message, index) => <Box key={index} bg="purple.50" p="2" mt="2"><Text fontSize="sm">{message}</Text></Box>)}{chainBlocking.length === 0 && <Text fontSize="xs" color="green.700" mt="2">来源版本均已核验、已钉住且无撤回。</Text>}</Box>
        </Flex>
        {blocked && <Button mt="4" size="sm" colorScheme="teal" isDisabled onClick={() => approve(claim.id)}>发布前校验未通过</Button>}
        {!blocked && <Button mt="4" size="sm" colorScheme="teal" onClick={() => approve(claim.id)}>批准发布并锁定快照</Button>}
      </Box>
    })}</Flex>
  </Box>
}
