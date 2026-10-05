import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge, Box, Button, Divider, Flex, FormControl, FormLabel, Grid, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Tab, TabList, TabPanel, TabPanels, Tabs, Text, Textarea, useDisclosure, useToast } from '@chakra-ui/react'
import { EvidenceGraph } from '../components/EvidenceGraph'
import { conclusionColor, useClaimStore } from '../store/useClaimStore'
import type { ClaimFact, EvidenceKind, FactConclusion, SourceRecord } from '../types'

export function ClaimWorkspace() {
  const { id } = useParams()
  const toast = useToast()
  const state = useClaimStore()
  const claim = state.claims.find((item) => item.id === id)
  const [selectedFactId, setSelectedFactId] = useState(claim?.facts[0]?.id ?? '')
  const selectedFact = claim?.facts.find((item) => item.id === selectedFactId) ?? claim?.facts[0]
  const [factText, setFactText] = useState('')
  const sourceModal = useDisclosure()
  const versionModal = useDisclosure()
  const [sourceForm, setSourceForm] = useState<Omit<SourceRecord, 'id' | 'capturedAt' | 'version'>>({ title: '', url: '', publisher: '', publishedAt: '2026-10-05', kind: '原始证据', chainOfCustody: '', contentHash: '' })
  const [counterSource, setCounterSource] = useState(false)
  const [transitionNote, setTransitionNote] = useState('')
  useEffect(() => { if (!selectedFactId && claim?.facts[0]) setSelectedFactId(claim.facts[0].id) }, [selectedFactId, claim])
  if (!claim) return <Box p="10">未找到核查主张</Box>
  const setFact = (patch: Partial<ClaimFact>) => { if (selectedFact) state.updateFact(claim.id, selectedFact.id, patch) }
  const addSource = () => {
    if (!selectedFact || !sourceForm.title || !sourceForm.url) return
    if (!sourceForm.contentHash.trim()) {
      toast({ title: '旧来源缺哈希：请先到收件台登记待核，补齐哈希后才能关联发布', status: 'warning' })
      return
    }
    const result = state.addSource(claim.id, selectedFact.id, sourceForm, counterSource)
    toast({ title: result.message, status: result.ok ? 'success' : 'error' })
    if (result.ok) sourceModal.onClose()
  }
  const transition = (status: typeof claim.status) => {
    const result = state.transitionClaim(claim.id, status, transitionNote || `由${claim.status}流转至${status}`)
    toast({ title: result.message, status: result.ok ? 'success' : 'error', duration: 4000 })
    if (result.ok) versionModal.onClose()
  }
  const exportArchive = () => {
    const versions = state.versions.filter((item) => item.claimId === claim.id)
    const audit = state.audit.filter((item) => item.claimId === claim.id)
    const snapshots = state.publishedSnapshots.filter((item) => item.claimId === claim.id)
    const registry = state.sourceRegistry.filter((entry) =>
      claim.facts.some((fact) => [...fact.sources, ...fact.counterSources].some((source) => source.url === entry.url)))
    const blob = new Blob([JSON.stringify({ claim, versions, audit, snapshots, registry }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${claim.id}-核查档案.json`; anchor.click(); URL.revokeObjectURL(url)
  }
  return <Box p="6" pb="16">
    <Flex justify="space-between" align="flex-start" mb="4"><Box><Text fontSize="xs" color="gray.600">{claim.id} · {claim.reporter} / {claim.editor} · V{claim.version}</Text><Text fontSize="xl" fontWeight="700" mt="1">{claim.title}</Text><Text color="gray.600" fontSize="sm" mt="2" maxW="760px">{claim.summary}</Text></Box><Flex gap="2"><Button variant="outline" onClick={exportArchive}>导出档案</Button><Button colorScheme="teal" onClick={versionModal.onOpen}>状态与版本</Button></Flex></Flex>
    <EvidenceGraph facts={claim.facts} />
    <Grid mt="4" templateColumns="320px 1fr" gap="4" alignItems="start">
      <Box bg="white" borderWidth="1px" p="3">
        <Flex justify="space-between" align="center" mb="3"><Text fontWeight="700">可验证事实树</Text><Badge>{claim.facts.length}</Badge></Flex>
        {claim.facts.map((fact) => {
          const uncertain = (fact.uncertainRefs ?? []).length
          const invalid = (fact.uncertainRefs ?? []).some((ref) => ref.invalidated)
          return <Box key={fact.id} as="button" textAlign="left" w="100%" p="3" mb="2" borderWidth="1px" borderColor={invalid ? 'red.500' : fact.id === selectedFact?.id ? 'teal.600' : 'gray.200'} bg={invalid ? 'red.50' : fact.id === selectedFact?.id ? 'teal.50' : 'white'} onClick={() => setSelectedFactId(fact.id)}><Flex justify="space-between"><Text fontSize="xs" color="gray.500">{fact.id}</Text><Badge colorScheme={conclusionColor[fact.conclusion]}>{fact.conclusion}</Badge></Flex><Text fontSize="sm" mt="2" fontWeight="600">{fact.text}</Text><Text fontSize="xs" color="gray.500" mt="2">置信度 {fact.confidence}% · 疑点 {fact.unresolved.length}</Text>{uncertain > 0 && <Badge mt="2" colorScheme={invalid ? 'red' : 'purple'}>{invalid ? '引用版本已撤回·待重算' : `引用不确定版本×${uncertain}`}</Badge>}</Box>
        })}
        <Flex mt="3" gap="2"><Input size="sm" placeholder="拆出新的可验证事实" value={factText} onChange={(event) => setFactText(event.target.value)} /><Button size="sm" colorScheme="teal" onClick={() => { state.addFact(claim.id, factText); setFactText('') }}>添加</Button></Flex>
      </Box>
      {selectedFact && <Box bg="white" borderWidth="1px" p="4">
        <Flex justify="space-between" align="flex-start"><Box><Text fontSize="xs" color="gray.500">{selectedFact.id}</Text><Text fontWeight="700" mt="1">{selectedFact.text}</Text></Box><Badge colorScheme={conclusionColor[selectedFact.conclusion]}>{selectedFact.conclusion}</Badge></Flex>
        {(selectedFact.uncertainRefs ?? []).length > 0 && <Box mt="3" p="3" bg="red.50" borderLeftWidth="3px" borderColor="red.500">
          {selectedFact.uncertainRefs!.map((ref) => <Box key={ref.sourceKey} mb="2">
            <Flex justify="space-between" align="center" gap="3">
              <Box><Text fontSize="sm" fontWeight="700" color={ref.invalidated ? 'red.700' : 'purple.700'}>{ref.invalidated ? '引用版本已撤回：未发布结论失效' : '引用不确定版本'}</Text><Text fontSize="xs" color="gray.600" wordBreak="break-all">{ref.url}{ref.pinnedHash ? ` · 钉住 ${ref.pinnedHash}` : ' · 未钉住任何哈希'}</Text><Text fontSize="xs" color="gray.500">{ref.reason}</Text></Box>
              {!ref.invalidated && <VersionPinSelect claimId={claim.id} factId={selectedFact.id} sourceKey={ref.sourceKey} />}
            </Flex>
          </Box>)}
          <Text fontSize="xs" color="gray.600">钉住确定版本后解除阻断；撤回导致的失效必须由核查员重算结论，不能自动恢复。</Text>
        </Box>}
        <Grid templateColumns="1fr 1fr 1fr" gap="3" mt="4">
          <FormControl><FormLabel fontSize="xs">事实结论</FormLabel><Select size="sm" value={selectedFact.conclusion} onChange={(event) => setFact({ conclusion: event.target.value as FactConclusion })}>{['已证实', '部分属实', '证据不足', '不实'].map((value) => <option key={value}>{value}</option>)}</Select></FormControl>
          <FormControl><FormLabel fontSize="xs">置信程度 {selectedFact.confidence}%</FormLabel><Input size="sm" type="range" min="0" max="100" value={selectedFact.confidence} onChange={(event) => setFact({ confidence: Number(event.target.value) })} /></FormControl>
          <FormControl><FormLabel fontSize="xs">未解决疑点</FormLabel><Input size="sm" value={selectedFact.unresolved.join('；')} onChange={(event) => setFact({ unresolved: event.target.value ? event.target.value.split('；') : [] })} /></FormControl>
        </Grid>
        <Tabs mt="5" colorScheme="teal">
          <TabList><Tab>支持证据 {selectedFact.sources.length}</Tab><Tab>相反证据 {selectedFact.counterSources.length}</Tab><Tab>批注 {selectedFact.annotations.length}</Tab><Tab>来源时间线</Tab></TabList>
          <TabPanels>
            <TabPanel px="0"><EvidenceList sources={selectedFact.sources} claimId={claim.id} factId={selectedFact.id} onAdd={() => { setCounterSource(false); sourceModal.onOpen() }} /></TabPanel>
            <TabPanel px="0"><EvidenceList sources={selectedFact.counterSources} claimId={claim.id} factId={selectedFact.id} onAdd={() => { setCounterSource(true); sourceModal.onOpen() }} counter /></TabPanel>
            <TabPanel px="0"><AnnotationList fact={selectedFact} claimId={claim.id} /></TabPanel>
            <TabPanel px="0"><Box borderLeftWidth="2px" borderColor="gray.300" pl="4">{[...selectedFact.sources, ...selectedFact.counterSources].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).map((source) => <Box key={source.id} mb="4"><Flex gap="2" align="center"><Text fontSize="xs" color="gray.500">{source.publishedAt} · {source.kind}</Text>{source.status && <Badge colorScheme={source.status === '有效' ? 'green' : source.status === '已撤回' ? 'red' : 'orange'}>{source.status}</Badge>}</Flex><Text fontWeight="600" mt="1">{source.title}</Text><Text fontSize="sm" color="gray.600">{source.publisher} · 留档 {source.capturedAt.replace('T', ' ').slice(0, 16)}</Text></Box>)}</Box></TabPanel>
          </TabPanels>
        </Tabs>
      </Box>}
    </Grid>
    <Modal isOpen={sourceModal.isOpen} onClose={sourceModal.onClose} size="xl"><ModalOverlay /><ModalContent><ModalHeader>{counterSource ? '关联相反证据' : '关联支持证据'}</ModalHeader><ModalCloseButton /><ModalBody><Grid templateColumns="1fr 1fr" gap="3"><FormControl><FormLabel>来源标题</FormLabel><Input value={sourceForm.title} onChange={(event) => setSourceForm({ ...sourceForm, title: event.target.value })} /></FormControl><FormControl><FormLabel>公开地址</FormLabel><Input value={sourceForm.url} onChange={(event) => setSourceForm({ ...sourceForm, url: event.target.value })} /></FormControl><FormControl><FormLabel>发布机构</FormLabel><Input value={sourceForm.publisher} onChange={(event) => setSourceForm({ ...sourceForm, publisher: event.target.value })} /></FormControl><FormControl><FormLabel>证据类型</FormLabel><Select value={sourceForm.kind} onChange={(event) => setSourceForm({ ...sourceForm, kind: event.target.value as EvidenceKind })}>{['原始证据', '二次来源', '待证信息'].map((value) => <option key={value}>{value}</option>)}</Select></FormControl><FormControl isRequired><FormLabel>内容哈希（sha256，必填）</FormLabel><Input placeholder="sha256:..." borderColor={sourceForm.contentHash ? undefined : 'red.300'} value={sourceForm.contentHash} onChange={(event) => setSourceForm({ ...sourceForm, contentHash: event.target.value })} /></FormControl><FormControl><FormLabel>留档说明</FormLabel><Input value={sourceForm.chainOfCustody} onChange={(event) => setSourceForm({ ...sourceForm, chainOfCustody: event.target.value })} /></FormControl></Grid><Text fontSize="xs" color="orange.700" mt="2">缺哈希的旧来源不能直接关联：请到「收件台」以待核件登记，哈希补齐后再引用。</Text></ModalBody><ModalFooter><Button variant="ghost" mr="3" onClick={sourceModal.onClose}>取消</Button><Button colorScheme="teal" isDisabled={!sourceForm.title || !sourceForm.url} onClick={addSource}>核验哈希并加入证据关系图</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={versionModal.isOpen} onClose={versionModal.onClose}><ModalOverlay /><ModalContent><ModalHeader>状态流转与版本说明</ModalHeader><ModalCloseButton /><ModalBody><FormControl mb="4"><FormLabel>版本变更说明</FormLabel><Textarea rows={4} value={transitionNote} onChange={(event) => setTransitionNote(event.target.value)} /></FormControl><Text fontSize="xs" color="gray.500">发布前收件链校验：待核来源、已撤回版本、引用不确定版本都会阻断发布；发布瞬间锁定深拷贝快照。</Text></ModalBody><ModalFooter><Button mr="2" onClick={() => transition('待编辑复核')}>提交编辑复核</Button><Button colorScheme="teal" onClick={() => transition('已发布')}>发布正式版本</Button></ModalFooter></ModalContent></Modal>
  </Box>
}

function VersionPinSelect({ claimId, factId, sourceKey }: { claimId: string; factId: string; sourceKey: string }) {
  const registry = useClaimStore((state) => state.sourceRegistry)
  const pin = useClaimStore((state) => state.pinSourceVersion)
  const versions = registry.filter((entry) => entry.key === sourceKey && entry.contentHash)
  const [value, setValue] = useState(versions.find((entry) => entry.status === '有效')?.contentHash ?? versions[0]?.contentHash ?? '')
  return <Flex gap="1" align="center">
    <Select size="xs" w="190px" value={value} onChange={(event) => setValue(event.target.value)}>{versions.map((entry) => <option key={entry.contentHash} value={entry.contentHash} disabled={entry.status === '已撤回'}>{entry.contentHash.slice(0, 22)}… {entry.status === '已撤回' ? '(已撤回)' : ''}</option>)}</Select>
    <Button size="xs" colorScheme="purple" isDisabled={!value} onClick={() => pin(claimId, factId, sourceKey, value)}>钉住此版</Button>
  </Flex>
}

function EvidenceList({ sources, claimId, factId, onAdd, counter = false }: { sources: SourceRecord[]; claimId: string; factId: string; onAdd: () => void; counter?: boolean }) {
  const registry = useClaimStore((state) => state.sourceRegistry)
  const pin = useClaimStore((state) => state.pinSourceVersion)
  return <Box><Flex justify="space-between" mb="3"><Text fontSize="sm" color="gray.600">{counter ? '相反证据与支持证据并列保留' : '按原始证据、二次来源、待证信息分类'}</Text><Button size="sm" colorScheme={counter ? 'red' : 'teal'} variant="outline" onClick={onAdd}>{counter ? '关联相反证据' : '关联支持证据'}</Button></Flex>{sources.map((source) => {
    const key = source.sourceKey ?? `URL:${source.url}`
    const family = registry.filter((entry) => entry.key === key && entry.contentHash)
    const pinnedHash = useClaimStore.getState().claims.find((claim) => claim.id === claimId)?.facts.find((fact) => fact.id === factId)?.versionRefs?.[key]
    return <Box key={source.id} borderWidth="1px" borderLeftWidth="3px" borderLeftColor={source.status === '已撤回' ? 'red.500' : source.status === '待核' ? 'orange.400' : 'green.400'} p="3" mb="2"><Flex justify="space-between"><Text fontWeight="600">{source.title}</Text><Flex gap="1"><Badge colorScheme={source.kind === '原始证据' ? 'green' : source.kind === '二次来源' ? 'orange' : 'gray'}>{source.kind}</Badge>{source.status && <Badge colorScheme={source.status === '有效' ? 'green' : source.status === '已撤回' ? 'red' : 'orange'}>{source.status}</Badge>}</Flex></Flex>
      <Text fontSize="xs" color="gray.600" mt="2">{source.publisher} · {source.publishedAt} · V{source.version}</Text>
      <Text fontFamily="mono" fontSize="xs" mt="2">{source.contentHash || '（缺哈希·待核）'}</Text>
      {family.length > 1 && <Flex mt="2" gap="1" align="center" wrap="wrap"><Text fontSize="xs" color="purple.700">该地址有 {family.length} 版：</Text><Select size="xs" w="210px" defaultValue={pinnedHash ?? source.contentHash} onChange={(event) => pin(claimId, factId, key, event.target.value)}>{family.map((entry) => <option key={entry.contentHash} value={entry.contentHash} disabled={entry.status === '已撤回'}>{entry.contentHash.slice(0, 22)}…{pinnedHash === entry.contentHash ? ' ·已钉' : ''}{entry.status === '已撤回' ? ' ·已撤回' : ''}</option>)}</Select>{pinnedHash === source.contentHash ? <Badge colorScheme="teal">事实钉住此版</Badge> : <Badge colorScheme="gray">事实另钉他版</Badge>}</Flex>}
      <Divider my="2" /><Text fontSize="xs">{source.chainOfCustody}</Text><Text fontSize="xs" color="blue.600" mt="1" wordBreak="break-all">{source.url}</Text></Box>
  })}</Box>
}

function AnnotationList({ fact, claimId }: { fact: ClaimFact; claimId: string }) {
  const addAnnotation = useClaimStore((state) => state.addAnnotation)
  const resolve = useClaimStore((state) => state.resolveAnnotation)
  const [text, setText] = useState('')
  return <Box><Flex gap="2" mb="3"><Input placeholder="添加事实核查批注" value={text} onChange={(event) => setText(event.target.value)} /><Button onClick={() => { addAnnotation(claimId, fact.id, { author: '陆衡', role: '事实核查员', content: text }); setText('') }}>添加</Button></Flex>{fact.annotations.map((item) => <Box key={item.id} borderLeftWidth="3px" borderColor={item.role === '系统' ? 'red.400' : item.resolved ? 'green.400' : 'orange.400'} bg={item.role === '系统' ? 'red.50' : item.resolved ? 'green.50' : 'orange.50'} p="3" mb="2"><Flex justify="space-between"><Text fontWeight="600" fontSize="sm">{item.role} {item.author}</Text>{item.role !== '系统' && <Button size="xs" variant="ghost" isDisabled={item.resolved} onClick={() => resolve(claimId, fact.id, item.id)}>{item.resolved ? '已解决' : '标记解决'}</Button>}</Flex><Text fontSize="sm" mt="2">{item.content}</Text><Text fontSize="xs" color="gray.500" mt="1">{item.createdAt.replace('T', ' ').slice(0, 16)}</Text></Box>)}</Box>
}
