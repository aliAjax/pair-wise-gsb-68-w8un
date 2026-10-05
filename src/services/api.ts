import axios from 'axios'
import type { Claim, SourceVersion } from '../types'
import { preflightPublish as preflight } from './chains'

const client = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 5000 })

export async function loadClaimSnapshot(fallback: Claim[]): Promise<Claim[]> {
  if (!import.meta.env.VITE_API_BASE_URL) return fallback
  try { return (await client.get<Claim[]>('/claims')).data } catch { return fallback }
}

/** 发布前校验已接入收件链：来源缺哈希/已撤回、引用版本不确定、结论待重算均阻断 */
export function preflightPublish(claim: Claim, registry: SourceVersion[] = []) {
  return preflight(registry, claim)
}
