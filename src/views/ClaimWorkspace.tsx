import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge, Box, Button, Divider, Flex, FormControl, FormLabel, Grid, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Tab, TabList, TabPanel, TabPanels, Tabs, Text, Textarea, useDisclosure, useToast } from '@chakra-ui/react'
import { EvidenceGraph } from '../components/EvidenceGraph'
import { conclusionColor, useClaimStore } from '../store/useClaimStore'
import { allRefs, preflightPublish, refIsAmbiguous, resolveRef, versionsOf } from '../services/chains'
import type { ClaimFact, EvidenceKind, FactConclusion, SourceVersion } from '../types'

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
  const [sourceForm, setSourceForm] = useState({ title: '', url: '', publisher: '', publishedAt: '2026-10-05', kind: '原始证据' as EvidenceKind, chainOfCustody: '', contentHash: '' })
  const [counterSource, setCounterSource] = useState(false)
  const [transitionNote, setTransitionNote] = useState('')
  const [recomputeForm, setRecomputeForm] = useState({ conclusion: '证据不足' as FactConclusion, confidence: 40, note: '' })
  useEffect(() => { if (!selectedFactId && claim?.facts[0]) setSelectedFactId(claim.facts[0].id) }, [selectedFactId, claim])
  if (!claim) return <Box p="10">未找到核查主张</Box>

  const preflight = preflightPublish(state.registry, claim)
  const snapshot = state.snapshots.find((item) => item.claimId === claim.id)
  const setFact = (patch: Partial<ClaimFact>) => { if (selectedFact) state.updateFact(claim.id, selectedFact.id, patch) }

  const addSource = () => {
    if (!selectedFact || !sourceForm.title || !sourceForm.url) return
    const result = state.submitSource(claim.id, selectedFact.id, sourceForm, counterSource)
    toast({ title: result.message, status: result.ok ? 'success' : 'warning', duration: 3200 })
    sourceModal.onClose()
  }
  const transition = (status: typeof claim.status) => {
    const result = state.transitionClaim(claim.id, status, transitionNote || `由${claim.status}流转至${status}`)
    toast({ title: result.message, status: result.ok ? 'success' : 'error', duration: 3600 })
    if (result.ok) versionModal.onClose()
  }
  const exportArchive = () => {
    const versions = state.versions.filter((item) => item.claimId === claim.id)
    const audit = state.audit.filter((item) => item.claimId === claim.id)
    const blob = new Blob([JSON.stringify({ claim, snapshot, versions, audit }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${claim.id}-核查档案.json`; anchor.click(); URL.revokeObjectURL(url)
  }

  return <Box p="6" pb="16">
    <Flex justify="space-between" align="flex-start" mb="4"><Box><Text fontSize="xs" color="gray.600">{claim.id} · {claim.reporter} / {claim.editor} · V{claim.version}</Text><Text fontSize="xl" fontWeight="700" mt="1">{claim.title}</Text><Text color="gray.600" fontSize="sm" mt="2" maxW="760px">{claim.summary}</Text></Box><Flex gap="2"><Button variant="outline" onClick={exportArchive}>导出档案</Button><Button colorScheme="teal" onClick={versionModal.onOpen}>状态与版本</Button></Flex></Flex>

    {claim.status === '已发布' && snapshot && <Box bg="green.50" borderWidth="1px" borderColor="green.300" p="3" mb="3">
      <Flex justify="space-between" align="center"><Box><Text fontSize="sm" fontWeight="700">已发布快照 {snapshot.id} · {snapshot.publishedAt.replace('T', ' ').slice(0, 16)} 冻结</Text><Text fontSize="xs" color="gray.600" mt="1">{snapshot.note}；发布后来源撤回不改动本主张，以下发布摘要仍可逐条追溯哈希。</Text></Box><Badge colorScheme="green">不可变</Badge></Flex>
      <Grid mt="2" templateColumns="repeat(2,1fr)" gap="2">{snapshot.factDigests.map((digest) => <Box key={digest.factId} bg="white" borderWidth="1px" p="2"><Text fontSize="xs" fontWeight="700">{digest.factId} · {digest.conclusion}（{digest.confidence}%）</Text>{digest.refs.map((ref) => <Flex key={ref.sourceId + ref.counter} justify="space-between" fontSize="xs" mt="1"><Text>{ref.counter ? '反证' : '支持'} · {ref.title}</Text><Text fontFamily="mono" color={ref.state === '已核验' ? 'green.700' : 'red.600'}>{ref.state} · {ref.hash}</Text></Flex>)}</Box>)}</Grid>
    </Box>}

    {claim.status !== '已发布' && (preflight.blocking.length > 0 || preflight.warnings.length > 0) && <Box bg={preflight.blocking.length ? 'red.50' : 'yellow.50'} borderWidth="1px" borderColor={preflight.blocking.length ? 'red.300' : 'yellow.300'} p="3" mb="3">
      <Text fontSize="sm" fontWeight="700">{preflight.blocking.length ? '发布阻断项' : '发布提醒'}</Text>
      {[...preflight.blocking, ...preflight.warnings.map((item) => `提醒：${item}`)].map((item) => <Text key={item} fontSize="xs" mt="1" color="gray.700">· {item}</Text>)}
    </Box>}

    <EvidenceGraph facts={claim.facts} registry={state.registry} />
    <Grid mt="4" templateColumns="320px 1fr" gap="4" alignItems="start">
      <Box bg="white" borderWidth="1px" p="3">
        <Flex justify="space-between" align="center" mb="3"><Text fontWeight="700">可验证事实树</Text><Badge>{claim.facts.length}</Badge></Flex>
        {claim.facts.map((fact) => {
          const ambiguous = allRefs(fact).some((ref) => refIsAmbiguous(state.registry, ref))
          const broken = allRefs(fact).some((ref) => !resolveRef(state.registry, ref))
          return <Box key={fact.id} as="button" textAlign="left" w="100%" p="3" mb="2" borderWidth="1px" borderColor={fact.id === selectedFact?.id ? 'teal.600' : 'gray.200'} bg={fact.recompute?.required ? 'red.50' : fact.id === selectedFact?.id ? 'teal.50' : 'white'} onClick={() => setSelectedFactId(fact.id)}>
            <Flex justify="space-between"><Text fontSize="xs" color="gray.500">{fact.id}</Text><Badge colorScheme={conclusionColor[fact.conclusion]}>{fact.conclusion}</Badge></Flex>
            <Text fontSize="sm" mt="2" fontWeight="600">{fact.text}</Text>
            <Text fontSize="xs" color="gray.500" mt="2">置信度 {fact.confidence}% · 疑点 {fact.unresolved.length}</Text>
            <Flex mt="2" gap="1" wrap="wrap">
              {fact.recompute?.required && <Badge colorScheme="red">失效待重算</Badge>}
              {ambiguous && <Badge colorScheme="orange">引用版本不确定</Badge>}
              {broken && <Badge colorScheme="red">断链</Badge>}
            </Flex>
          </Box>
        })}
        <Flex mt="3" gap="2"><Input size="sm" placeholder="拆出新的可验证事实" value={factText} onChange={(event) => setFactText(event.target.value)} /><Button size="sm" colorScheme="teal" onClick={() => { state.addFact(claim.id, factText); setFactText('') }}>添加</Button></Flex>
      </Box>
      {selectedFact && <Box bg="white" borderWidth="1px" p="4">
        <Flex justify="space-between" align="flex-start"><Box><Text fontSize="xs" color="gray.500">{selectedFact.id}</Text><Text fontWeight="700" mt="1">{selectedFact.text}</Text></Box><Badge colorScheme={conclusionColor[selectedFact.conclusion]}>{selectedFact.conclusion}</Badge></Flex>

        {selectedFact.recompute?.required && <Box bg="red.50" borderWidth="1px" borderColor="red.300" p="3" mt="3">
          <Text fontSize="sm" fontWeight="700">结论已失效，须重算后才能再发布</Text>
          <Text fontSize="xs" color="gray.700" mt="1">原因：{selectedFact.recompute.reason}</Text>
          <Text fontSize="xs" color="gray.500" mt="1">原结论：{selectedFact.recompute.prevConclusion}（{selectedFact.recompute.prevConfidence}%）</Text>
          <Grid templateColumns="1fr 1fr 2fr auto" gap="2" mt="2" alignItems="end">
            <FormControl><FormLabel fontSize="xs">重算结论</FormLabel><Select size="sm" value={recomputeForm.conclusion} onChange={(event) => setRecomputeForm((form) => ({ ...form, conclusion: event.target.value as FactConclusion }))}>{['已证实', '部分属实', '证据不足', '不实'].map((value) => <option key={value}>{value}</option>)}</Select></FormControl>
            <FormControl><FormLabel fontSize="xs">置信度 {recomputeForm.confidence}%</FormLabel><Input size="sm" type="range" min="0" max="100" value={recomputeForm.confidence} onChange={(event) => setRecomputeForm((form) => ({ ...form, confidence: Number(event.target.value) }))} /></FormControl>
            <FormControl><FormLabel fontSize="xs">重算说明</FormLabel><Input size="sm" value={recomputeForm.note} onChange={(event) => setRecomputeForm((form) => ({ ...form, note: event.target.value }))} placeholder="替换/补证后重算的依据" /></FormControl>
            <Button size="sm" colorScheme="red" onClick={() => { state.resolveRecompute(claim.id, selectedFact.id, recomputeForm.conclusion, recomputeForm.confidence, recomputeForm.note); toast({ title: '重算已完成，撤回系统批注已关闭', status: 'success' }) }}>确认重算</Button>
          </Grid>
        </Box>}

        <Grid templateColumns="1fr 1fr 1fr" gap="3" mt="4">
          <FormControl><FormLabel fontSize="xs">事实结论</FormLabel><Select size="sm" isDisabled={selectedFact.recompute?.required} value={selectedFact.conclusion} onChange={(event) => setFact({ conclusion: event.target.value as FactConclusion })}>{['已证实', '部分属实', '证据不足', '不实'].map((value) => <option key={value}>{value}</option>)}</Select></FormControl>
          <FormControl><FormLabel fontSize="xs">置信程度 {selectedFact.confidence}%</FormLabel><Input size="sm" type="range" min="0" max="100" isDisabled={selectedFact.recompute?.required} value={selectedFact.confidence} onChange={(event) => setFact({ confidence: Number(event.target.value) })} /></FormControl>
          <FormControl><FormLabel fontSize="xs">未解决疑点</FormLabel><Input size="sm" value={selectedFact.unresolved.join('；')} onChange={(event) => setFact({ unresolved: event.target.value ? event.target.value.split('；') : [] })} /></FormControl>
        </Grid>
        <Tabs mt="5" colorScheme="teal">
          <TabList><Tab>支持证据 {selectedFact.sources.length}</Tab><Tab>相反证据 {selectedFact.counterSources.length}</Tab><Tab>批注 {selectedFact.annotations.length}</Tab><Tab>来源时间线</Tab></TabList>
          <TabPanels>
            <TabPanel px="0"><EvidenceList registry={state.registry} fact={selectedFact} sources={selectedFact.sources} claimId={claim.id} onAdd={() => { setCounterSource(false); sourceModal.onOpen() }} /></TabPanel>
            <TabPanel px="0"><EvidenceList registry={state.registry} fact={selectedFact} sources={selectedFact.counterSources} claimId={claim.id} onAdd={() => { setCounterSource(true); sourceModal.onOpen() }} counter /></TabPanel>
            <TabPanel px="0"><AnnotationList fact={selectedFact} claimId={claim.id} /></TabPanel>
            <TabPanel px="0"><Timeline registry={state.registry} fact={selectedFact} /></TabPanel>
          </TabPanels>
        </Tabs>
      </Box>}
    </Grid>
    <Modal isOpen={sourceModal.isOpen} onClose={sourceModal.onClose} size="xl"><ModalOverlay /><ModalContent><ModalHeader>{counterSource ? '关联相反证据' : '关联支持证据'}（核查员提交）</ModalHeader><ModalCloseButton /><ModalBody>
      <Text fontSize="xs" color="orange.600" mb="3">同址同哈希视为同一版本：你是后到者时不会新建卡片，系统只留存你的比对值；同址哈希不同则保留为新版本。缺哈希的来源只能待核。</Text>
      <Grid templateColumns="1fr 1fr" gap="3">
        <FormControl><FormLabel>来源标题</FormLabel><Input value={sourceForm.title} onChange={(event) => setSourceForm({ ...sourceForm, title: event.target.value })} /></FormControl>
        <FormControl><FormLabel>公开地址</FormLabel><Input value={sourceForm.url} onChange={(event) => setSourceForm({ ...sourceForm, url: event.target.value })} /></FormControl>
        <FormControl><FormLabel>发布机构</FormLabel><Input value={sourceForm.publisher} onChange={(event) => setSourceForm({ ...sourceForm, publisher: event.target.value })} /></FormControl>
        <FormControl><FormLabel>证据类型</FormLabel><Select value={sourceForm.kind} onChange={(event) => setSourceForm({ ...sourceForm, kind: event.target.value as EvidenceKind })}>{['原始证据', '二次来源', '待证信息'].map((value) => <option key={value}>{value}</option>)}</Select></FormControl>
        <FormControl><FormLabel>内容哈希（留空=待核，阻断发布）</FormLabel><Input placeholder="sha256:..." value={sourceForm.contentHash} onChange={(event) => setSourceForm({ ...sourceForm, contentHash: event.target.value })} /></FormControl>
        <FormControl><FormLabel>留档说明</FormLabel><Input value={sourceForm.chainOfCustody} onChange={(event) => setSourceForm({ ...sourceForm, chainOfCustody: event.target.value })} /></FormControl>
      </Grid>
    </ModalBody><ModalFooter><Button variant="ghost" mr="3" onClick={sourceModal.onClose}>取消</Button><Button colorScheme="teal" isDisabled={!sourceForm.title || !sourceForm.url} onClick={addSource}>提交并比对</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={versionModal.isOpen} onClose={versionModal.onClose}><ModalOverlay /><ModalContent><ModalHeader>状态流转与版本说明</ModalHeader><ModalCloseButton /><ModalBody><FormControl mb="4"><FormLabel>版本变更说明</FormLabel><Textarea rows={4} value={transitionNote} onChange={(event) => setTransitionNote(event.target.value)} /></FormControl>
      <Box bg="gray.50" p="3"><Text fontSize="xs" fontWeight="700">发布前校验</Text>{preflight.blocking.length === 0 ? <Text fontSize="xs" color="green.700" mt="1">通过：所有引用已钉版、来源可核验、无待重算结论，发布将冻结不可变快照。</Text> : preflight.blocking.map((item) => <Text key={item} fontSize="xs" color="red.600" mt="1">· {item}</Text>)}</Box>
    </ModalBody><ModalFooter><Button mr="2" onClick={() => transition('待编辑复核')}>提交编辑复核</Button><Button colorScheme="teal" isDisabled={preflight.blocking.length > 0} onClick={() => transition('已发布')}>发布正式版本并冻结快照</Button></ModalFooter></ModalContent></Modal>
  </Box>
}

function StateBadge({ source }: { source: SourceVersion }) {
  return <Badge colorScheme={source.state === '已撤回' ? 'red' : source.state === '待核' ? 'orange' : 'green'}>{source.state}</Badge>
}

function EvidenceList({ registry, fact, sources, claimId, onAdd, counter = false }: { registry: SourceVersion[]; fact: ClaimFact; sources: ClaimFact['sources']; claimId: string; onAdd: () => void; counter?: boolean }) {
  const pinRef = useClaimStore((state) => state.pinRef)
  const verifySourceHash = useClaimStore((state) => state.verifySourceHash)
  const toast = useToast()
  const [pinChoice, setPinChoice] = useState<Record<string, string>>({})
  const [hashPatch, setHashPatch] = useState('')

  return <Box>
    <Flex justify="space-between" mb="3"><Text fontSize="sm" color="gray.600">{counter ? '相反证据与支持证据并列保留' : '按原始证据、二次来源、待证信息分类'}</Text><Button size="sm" colorScheme={counter ? 'red' : 'teal'} variant="outline" onClick={onAdd}>{counter ? '提交相反证据' : '提交支持证据'}</Button></Flex>
    {sources.map((ref) => {
      const source = resolveRef(registry, ref)
      const ambiguous = refIsAmbiguous(registry, ref)
      const lineage = ref.urlKey ? versionsOf(registry, ref.urlKey) : []
      if (!source) return <Box key={ref.refId} borderWidth="1px" borderColor="red.400" p="3" mb="2"><Badge colorScheme="red">断链引用</Badge><Text fontSize="xs" mt="1" fontFamily="mono">{ref.urlKey ?? ref.sourceId}</Text></Box>
      return <Box key={ref.refId} borderWidth="1px" p="3" mb="2" borderColor={source.state === '已撤回' ? 'red.400' : source.state === '待核' ? 'orange.400' : ambiguous ? 'orange.400' : 'gray.200'}>
        <Flex justify="space-between"><Text fontWeight="600">{source.title}</Text><Flex gap="1"><StateBadge source={source} /><Badge colorScheme={source.kind === '原始证据' ? 'green' : source.kind === '二次来源' ? 'orange' : 'gray'}>{source.kind}</Badge></Flex></Flex>
        <Text fontSize="xs" color="gray.600" mt="2">{source.publisher} · {source.publishedAt} · V{source.versionNo} · {ref.pinned ? '已钉版' : '未钉版（按地址引用）'}</Text>
        <Text fontFamily="mono" fontSize="xs" mt="2" color={ref.hash ? 'gray.700' : 'red.500'}>{ref.hash ?? '引用无哈希'}</Text>
        {source.state === '已撤回' && <Text fontSize="xs" color="red.700" mt="1">该版本已于 {source.retractedAt?.replace('T', ' ').slice(0, 16)} 撤回；未发布依赖结论须重算，已发布快照不受影响。</Text>}
        {ambiguous && <Box bg="orange.50" p="2" mt="2">
          <Text fontSize="xs" color="orange.800" fontWeight="700">引用版本不确定：同一公开地址存在多个内容哈希版本，发布前必须钉版</Text>
          <Flex mt="2" gap="2" align="center">
            <Select size="xs" maxW="320px" value={pinChoice[ref.refId] ?? ''} onChange={(event) => setPinChoice((map) => ({ ...map, [ref.refId]: event.target.value }))}>
              <option value="">选择要钉住的版本…</option>
              {lineage.map((item) => <option key={item.id} value={item.id}>V{item.versionNo} · {item.contentHash} · {item.state}</option>)}
            </Select>
            <Button size="xs" colorScheme="orange" isDisabled={!pinChoice[ref.refId]} onClick={() => { pinRef(claimId, fact.id, ref.refId, pinChoice[ref.refId]); toast({ title: '已钉住确定版本', status: 'success' }) }}>钉住该版本</Button>
          </Flex>
        </Box>}
        {source.state === '待核' && <Box bg="orange.50" p="2" mt="2">
          <Text fontSize="xs" color="orange.800">旧来源/收件缺哈希，先待核，不能直接参与发布。</Text>
          <Flex mt="2" gap="2" align="center"><Input size="xs" maxW="320px" placeholder="补算内容哈希 sha256:..." value={hashPatch} onChange={(event) => setHashPatch(event.target.value)} /><Button size="xs" colorScheme="orange" onClick={() => { const result = verifySourceHash(source.id, hashPatch); toast({ title: result.message, status: result.ok ? 'success' : 'warning' }); if (result.ok) setHashPatch('') }}>补哈希核验</Button></Flex>
        </Box>}
        <Divider my="2" /><Text fontSize="xs">{source.chainOfCustody}</Text><Text fontSize="xs" color="blue.600" mt="1" wordBreak="break-all">{source.url}</Text>
      </Box>
    })}
  </Box>
}

function Timeline({ registry, fact }: { registry: SourceVersion[]; fact: ClaimFact }) {
  const refs = allRefs(fact)
  const entries = refs.map((ref) => resolveRef(registry, ref)).filter((item): item is SourceVersion => Boolean(item))
  const sorted = [...entries].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
  return <Box borderLeftWidth="2px" borderColor="gray.300" pl="4">
    {sorted.length === 0 && <Text fontSize="xs" color="gray.500">暂无来源</Text>}
    {sorted.map((source) => <Box key={source.id} mb="4"><Text fontSize="xs" color="gray.500">{source.publishedAt} · {source.kind} · V{source.versionNo}</Text><Text fontWeight="600" mt="1">{source.title}</Text><Flex gap="2" mt="1"><StateBadge source={source} /><Text fontFamily="mono" fontSize="xs">{source.contentHash || '无哈希'}</Text></Flex><Text fontSize="sm" color="gray.600">{source.publisher} · 留档 {source.capturedAt.replace('T', ' ').slice(0, 16)}</Text></Box>)}
  </Box>
}

function AnnotationList({ fact, claimId }: { fact: ClaimFact; claimId: string }) {
  const addAnnotation = useClaimStore((state) => state.addAnnotation)
  const resolve = useClaimStore((state) => state.resolveAnnotation)
  const [text, setText] = useState('')
  return <Box><Flex gap="2" mb="3"><Input placeholder="添加事实核查批注" value={text} onChange={(event) => setText(event.target.value)} /><Button onClick={() => { addAnnotation(claimId, fact.id, { author: '陆衡', role: '事实核查员', content: text }); setText('') }}>添加</Button></Flex>{fact.annotations.map((item) => <Box key={item.id} borderLeftWidth="3px" borderColor={item.role === '系统' ? 'purple.400' : item.resolved ? 'green.400' : 'orange.400'} bg={item.resolved ? 'green.50' : item.role === '系统' ? 'purple.50' : 'orange.50'} p="3" mb="2"><Flex justify="space-between"><Text fontWeight="600" fontSize="sm">{item.role} {item.author}</Text><Button size="xs" variant="ghost" isDisabled={item.resolved} onClick={() => resolve(claimId, fact.id, item.id)}>{item.resolved ? '已解决' : '标记解决'}</Button></Flex><Text fontSize="sm" mt="2">{item.content}</Text><Text fontSize="xs" color="gray.500" mt="1">{item.createdAt.replace('T', ' ').slice(0, 16)}</Text></Box>)}</Box>
}
