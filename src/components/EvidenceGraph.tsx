import { Badge, Box, Flex, Text } from '@chakra-ui/react'
import { allRefs, refIsAmbiguous, resolveRef } from '../services/chains'
import type { ClaimFact, SourceVersion } from '../types'

export function EvidenceGraph({ facts, registry = [] }: { facts: ClaimFact[]; registry?: SourceVersion[] }) {
  return <Box borderWidth="1px" bg="white" p="4">
    <Flex justify="space-between" mb="3"><Text fontWeight="700">主张与证据关系（来源按 公开地址+哈希 钉版）</Text><Text fontSize="xs" color="gray.600">实线支持 / 虚线反驳；橙=版本不确定或待核，红=撤回/失效重算</Text></Flex>
    <Flex overflowX="auto" gap="3" minH="150px" align="center">
      <Box minW="150px" bg="teal.700" color="white" p="3" borderRadius="4px"><Text fontSize="xs">核查主张</Text><Text fontWeight="700" mt="2">待发布报告</Text></Box>
      {facts.map((fact) => {
        const refs = allRefs(fact)
        const ambiguous = refs.some((ref) => refIsAmbiguous(registry, ref))
        const pending = refs.some((ref) => resolveRef(registry, ref)?.state === '待核')
        const retracted = refs.some((ref) => resolveRef(registry, ref)?.state === '已撤回')
        return <Box key={fact.id} minW="230px" borderWidth="1px" borderColor={fact.recompute?.required ? 'red.500' : ambiguous ? 'orange.400' : 'gray.300'} p="3" position="relative" _before={{ content: '"—"', position: 'absolute', left: '-12px', color: 'teal.600' }}>
          <Text fontSize="xs" color="gray.500">事实 {fact.id}</Text>
          <Text fontSize="sm" fontWeight="700" mt="1">{fact.text}</Text>
          <Flex mt="1" gap="1" wrap="wrap">
            {fact.recompute?.required && <Badge colorScheme="red">失效待重算</Badge>}
            {ambiguous && <Badge colorScheme="orange">版本不确定</Badge>}
            {pending && <Badge colorScheme="orange">含待核</Badge>}
            {retracted && <Badge colorScheme="red">含撤回版</Badge>}
          </Flex>
          <Flex mt="3" gap="2"><Box flex="1" borderWidth="1px" borderColor="green.300" p="2"><Text fontSize="xs">支持 {fact.sources.length}</Text></Box><Box flex="1" borderWidth="1px" borderColor="red.300" borderStyle="dashed" p="2"><Text fontSize="xs">反驳 {fact.counterSources.length}</Text></Box></Flex>
        </Box>
      })}
    </Flex>
  </Box>
}
