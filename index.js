/**
 * Host half of the account switcher.
 *
 * DeepSeek's browser sign-in is a single-attempt PKCE flow whose authorize URL
 * is bound to one verifier and one state, so N accounts cannot be logged in from
 * N URLs. What the harness *does* support is swapping the stored grant: the
 * platform account provider re-reads `deepseek-account-platform/default` on
 * every operation and invalidates its cached identity whenever
 * `credentials/record-updated` fires. This plugin keeps several grants in a
 * local vault and writes one of them back to that record, which switches the
 * account for the next model request without touching any shipped code.
 *
 * Tokens are bearer credentials: the vault lives in the same 0600 credentials
 * document as the active grant, is never logged, and never leaves the Host
 * except through the deliberate `export` operation.
 */

import { createHash, randomUUID } from 'node:crypto'

/** Active grant record owned by the platform account provider. */
const PLATFORM_KEY = 'deepseek-account-platform/default'
/** This plugin's own vault record, in the same credentials document. */
const VAULT_KEY = 'account-switcher/vault'
/** Loopback route the settings page calls. */
const ROUTE_PATH = '/account-switcher/api'
const DEFAULT_ISSUER = 'https://platform.deepseek.com'
const VAULT_VERSION = 1
const MAX_ACCOUNTS = 50
const MAX_BODY_BYTES = 256 * 1024
const IDENTITY_TIMEOUT_MS = 8_000
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const MODELS_URL = 'https://api.deepseek.com/models'
const BALANCE_CACHE_MS = 60_000

/** The platform rejects any token outside printable ASCII. */
const TOKEN_PATTERN = /^[\x21-\x7e]+$/
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]']

/** Services this plugin needs before it activates. */
export const inject = ['credentials', 'deepseekAccount', 'webServer']

/**
 * Register the account vault, settings route, and automatic credential persistence.
 * @param ctx - owning Host context with credentials, account, and web server services.
 */
export function apply(ctx) {
  ctx.effect(() => registerRoute(ctx), 'account-switcher: settings route')
  ctx.effect(() => {
    // 1. Initial auto-save on startup/apply
    void autoSaveCurrent(ctx)

    // 2. Auto-save whenever credentials record is updated
    const dispose = ctx.on('credentials/record-updated', (key) => {
      if (key === PLATFORM_KEY) {
        void autoSaveCurrent(ctx)
      }
    })
    return dispose
  }, 'account-switcher: auto-save active account')
}

/* ------------------------------------------------------------------ vault */

/** @returns an empty vault document. */
function emptyVault() {
  return { version: VAULT_VERSION, accounts: [] }
}

/**
 * Read the stored vault. A record written by another owner, or a payload that is
 * not this plugin's shape, reads as empty rather than throwing.
 * @param ctx - Host context.
 * @returns the normalized vault.
 */
async function readVault(ctx) {
  const record = await ctx.credentials.readRecord(VAULT_KEY)
  if (record === undefined || record.kind !== 'grant') return emptyVault()
  const payload = record.payload
  if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.accounts)) return emptyVault()
  const accounts = []
  for (const candidate of payload.accounts) {
    const account = normalizeAccount(candidate)
    if (account !== undefined) accounts.push(account)
  }
  return { version: VAULT_VERSION, accounts }
}

/**
 * Replace the whole vault through the serialized record write, so two windows
 * cannot lose one another's additions.
 * @param ctx - Host context.
 * @param vault - vault document to persist.
 */
async function writeVault(ctx, vault) {
  const payload = { version: VAULT_VERSION, accounts: vault.accounts }
  await ctx.credentials.modifyRecord(VAULT_KEY, async () => ({ kind: 'grant', payload }))
}

/**
 * Admit one stored vault entry.
 * @param candidate - value read from storage.
 * @returns the normalized entry, or undefined when it is not a usable grant.
 */
function normalizeAccount(candidate) {
  if (candidate === null || typeof candidate !== 'object') return undefined
  const { id, token, issuer } = candidate
  if (typeof id !== 'string' || id === '') return undefined
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return undefined
  if (typeof issuer !== 'string' || issuer === '') return undefined
  return {
    id,
    label: typeof candidate.label === 'string' ? candidate.label : '',
    token,
    tokenHash: typeof candidate.tokenHash === 'string' && candidate.tokenHash !== ''
      ? candidate.tokenHash
      : hashToken(token),
    issuer,
    userId: typeof candidate.userId === 'string' ? candidate.userId : '',
    name: typeof candidate.name === 'string' ? candidate.name : '',
    contact: typeof candidate.contact === 'string' ? candidate.contact : '',
    verified: candidate.verified === true,
    addedAt: typeof candidate.addedAt === 'string' ? candidate.addedAt : '',
    lastUsedAt: typeof candidate.lastUsedAt === 'string' ? candidate.lastUsedAt : '',
    balance: candidate.balance ?? null,
    latencyMs: typeof candidate.latencyMs === 'number' ? candidate.latencyMs : null,
    models: Array.isArray(candidate.models) ? candidate.models : [],
  }
}

/** @param token - bearer token. @returns its stable non-reversible fingerprint. */
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 32)
}

/** @param token - bearer token. @returns a display hint that is not a credential. */
function tokenHint(token) {
  return token.length <= 12 ? '••••••' : `${token.slice(0, 4)}…${token.slice(-4)}`
}

/* ------------------------------------------------------------- account state */

/**
 * Read the currently stored grant without interpreting the provider's payload
 * beyond the two fields this plugin needs.
 * @param ctx - Host context.
 * @returns the stored grant, or undefined while signed out.
 */
async function readCurrentGrant(ctx) {
  const record = await ctx.credentials.readRecord(PLATFORM_KEY)
  if (record === undefined || record.kind !== 'grant') return undefined
  const payload = record.payload
  if (payload === null || typeof payload !== 'object') return undefined
  if (typeof payload.token !== 'string' || typeof payload.issuer !== 'string') return undefined
  return { token: payload.token, issuer: payload.issuer }
}

/**
 * The origin a stored grant must carry to be accepted by the mounted provider.
 * @param ctx - Host context.
 * @returns the expected issuer origin.
 */
async function expectedIssuer(ctx) {
  const current = await readCurrentGrant(ctx)
  if (current !== undefined) return current.issuer
  try {
    const session = await ctx.deepseekAccount.getPlatformSession()
    if (session !== null) return session.origin
  } catch {
    // fallback
  }
  return DEFAULT_ISSUER
}

/**
 * Count running work whose latest bound request used the account route.
 * @param ctx - Host context.
 * @returns the number of affected tasks.
 */
function runningAccountTasks(ctx) {
  const agents = ctx.get('agents')
  if (agents === undefined) return 0
  let count = 0
  for (const agent of agents.list()) {
    if (agent.status !== 'running') continue
    if (agent.session?.requestContext?.()?.provider === 'deepseek-account') count++
  }
  return count
}

/** @param ctx - Host context. @returns Platform client identity for account reads. */
function clientMetadata(ctx) {
  return {
    version: 'account-switcher',
    locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/** Identity reads are cached briefly so opening the panel does not hit Platform every time. */
const profileCache = new Map()
const PROFILE_CACHE_MS = 30_000

/** Balance reads cache to keep panel snappy */
const balanceCache = new Map()

/**
 * Read the signed-in profile for the account panel header.
 * @param ctx - Host context.
 * @param tokenHash - fingerprint of the grant the cache is keyed by.
 * @returns the profile, or null when it is unknown or the read failed.
 */
async function currentProfile(ctx, tokenHash) {
  const cached = profileCache.get(tokenHash)
  if (cached !== undefined && Date.now() - cached.at < PROFILE_CACHE_MS) return cached.value
  let value = null
  try {
    const details = await ctx.deepseekAccount.getProfile(clientMetadata(ctx))
    if (details !== null && details.status === 'ready') {
      value = { name: details.value.name ?? '', contact: details.value.contact ?? '', userId: details.value.id ?? '' }
    }
  } catch {
    value = null
  }
  profileCache.set(tokenHash, { at: Date.now(), value })
  return value
}

/**
 * Read the balance of a grant from DeepSeek API endpoint.
 * @param token - Bearer token.
 * @returns normalized balance info or null.
 */
async function fetchBalance(token) {
  const signal = AbortSignal.timeout(IDENTITY_TIMEOUT_MS)
  try {
    const response = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: {
        'x-dsh-auth-token': token,
        'accept': 'application/json',
      },
      signal,
    })
    if (!response.ok) return null
    const payload = await response.json()
    if (!payload || !Array.isArray(payload.balance_infos) || payload.balance_infos.length === 0) return null
    const info = payload.balance_infos[0]
    return {
      isAvailable: payload.is_available === true,
      currency: info.currency || 'CNY',
      total: info.total_balance ?? '0.00',
      granted: info.granted_balance ?? '0.00',
      toppedUp: info.topped_up_balance ?? '0.00',
    }
  } catch {
    return null
  }
}

/**
 * Probe model availability and latency.
 * @param token - Bearer token.
 * @returns probe result with latencyMs and available models.
 */
async function probeModels(token) {
  const start = Date.now()
  const signal = AbortSignal.timeout(IDENTITY_TIMEOUT_MS)
  try {
    const response = await fetch(MODELS_URL, {
      method: 'GET',
      headers: {
        'x-dsh-auth-token': token,
        'accept': 'application/json',
      },
      signal,
    })
    const latencyMs = Date.now() - start
    if (response.status === 200) {
      const payload = await response.json()
      const models = Array.isArray(payload?.data) ? payload.data.map(m => m.id) : []
      return { ok: true, status: 200, latencyMs, models }
    }
    return { ok: false, status: response.status, latencyMs, models: [] }
  } catch (err) {
    return { ok: false, status: -1, latencyMs: Date.now() - start, models: [], error: err.message }
  }
}

/**
 * Read the profile of a grant through the Platform endpoint.
 * @param issuer - grant issuer origin.
 * @param token - bearer token to identify.
 * @returns the identity outcome; `invalid` marks a rejected credential.
 */
async function fetchIdentity(issuer, token) {
  const signal = AbortSignal.timeout(IDENTITY_TIMEOUT_MS)
  let response
  try {
    response = await fetch(`${issuer}/auth-api/v0/users/current`, {
      method: 'GET',
      redirect: 'error',
      signal,
      headers: {
        'x-dsh-auth-token': token,
        'x-client-bundle-id': '',
        'x-client-platform': 'web',
        'x-client-version': 'account-switcher',
        'x-client-locale': 'zh_CN',
        'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
      },
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined)
    return { ok: false, reason: 'invalid' }
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return { ok: false, reason: 'unreachable' }
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (payload?.code !== 0 || payload?.data?.biz_code !== 0) {
    return { ok: false, reason: payload?.code === 40003 ? 'invalid' : 'unreachable' }
  }
  const user = payload.data.biz_data ?? {}
  return {
    ok: true,
    userId: typeof user.id === 'string' ? user.id : '',
    name: typeof user.id_profile?.name === 'string' ? user.id_profile.name : '',
    contact: typeof user.mobile === 'string' && user.mobile !== ''
      ? user.mobile
      : typeof user.mobile_number === 'string' && user.mobile_number !== ''
        ? user.mobile_number
        : typeof user.email === 'string' ? user.email : '',
  }
}

/* ---------------------------------------------------------------- operations */

/**
 * Project the vault plus the active account for the settings panel.
 * @param ctx - Host context.
 * @returns the panel snapshot.
 */
async function listState(ctx) {
  const vault = await readVault(ctx)
  const current = await readCurrentGrant(ctx)
  const currentHash = current === undefined ? '' : hashToken(current.token)
  let status = 'signed-out'
  try {
    const state = await ctx.deepseekAccount.getState()
    status = state.status
  } catch {
    status = 'unavailable'
  }
  const profile = current === undefined ? null : await currentProfile(ctx, currentHash)
  const currentEntry = vault.accounts.find(account => account.tokenHash === currentHash)

  // Self-healing: auto-save if signed in but not yet stored in vault
  if (current !== undefined && currentEntry === undefined) {
    void autoSaveCurrent(ctx)
  }

  // Fetch or retrieve cached balance for active account
  let currentBalance = currentEntry?.balance ?? null
  if (current !== undefined) {
    const cached = balanceCache.get(currentHash)
    if (cached !== undefined && Date.now() - cached.at < BALANCE_CACHE_MS) {
      currentBalance = cached.value
    } else {
      const fresh = await fetchBalance(current.token)
      if (fresh !== null) {
        currentBalance = fresh
        balanceCache.set(currentHash, { at: Date.now(), value: fresh })
      }
    }
  }

  return {
    signedIn: status === 'credential-stored',
    status,
    current: current === undefined ? null : {
      accountId: currentEntry?.id ?? '',
      label: currentEntry?.label ?? '',
      name: profile?.name ?? currentEntry?.name ?? '',
      contact: profile?.contact ?? currentEntry?.contact ?? '',
      tokenHint: tokenHint(current.token),
      issuer: current.issuer,
      balance: currentBalance,
      latencyMs: currentEntry?.latencyMs ?? null,
      models: currentEntry?.models ?? [],
    },
    accounts: vault.accounts.map(account => {
      const isCurrent = account.tokenHash === currentHash
      return {
        id: account.id,
        label: account.label,
        name: account.name,
        contact: account.contact,
        tokenHint: tokenHint(account.token),
        issuer: account.issuer,
        verified: account.verified,
        addedAt: account.addedAt,
        lastUsedAt: account.lastUsedAt,
        current: isCurrent,
        balance: isCurrent && currentBalance ? currentBalance : (account.balance ?? null),
        latencyMs: account.latencyMs ?? null,
        models: account.models ?? [],
      }
    }),
    runningTasks: runningAccountTasks(ctx),
  }
}

let autoSaving = false

/**
 * Automatically persist active account to vault if not already stored.
 * @param ctx - Host context.
 * @param label - optional label.
 */
async function autoSaveCurrent(ctx, label = '') {
  if (autoSaving) return { ok: false, error: 'busy' }
  autoSaving = true
  try {
    const current = await readCurrentGrant(ctx)
    if (current === undefined) return { ok: false, error: 'signed-out' }
    const vault = await readVault(ctx)
    const tokenHash = hashToken(current.token)
    if (vault.accounts.some(account => account.tokenHash === tokenHash)) {
      return { ok: true, duplicate: true, state: await listState(ctx) }
    }
    if (vault.accounts.length >= MAX_ACCOUNTS) return { ok: false, error: 'vault-full' }

    const [identity, balance, probe] = await Promise.all([
      fetchIdentity(current.issuer, current.token),
      fetchBalance(current.token),
      probeModels(current.token),
    ])

    const account = {
      id: randomUUID(),
      label: cleanLabel(label) || identity.name || identity.contact || `账号 ${vault.accounts.length + 1}`,
      token: current.token,
      tokenHash,
      issuer: current.issuer,
      userId: identity.userId ?? '',
      name: identity.name ?? '',
      contact: identity.contact ?? '',
      verified: identity.ok === true && probe.ok === true,
      addedAt: new Date().toISOString(),
      lastUsedAt: '',
      balance,
      latencyMs: probe.latencyMs,
      models: probe.models || [],
    }
    await writeVault(ctx, { ...vault, accounts: [...vault.accounts, account] })
    return { ok: true, id: account.id, verified: account.verified, state: await listState(ctx) }
  } finally {
    autoSaving = false
  }
}

/**
 * Add the signed-in grant to the vault.
 * @param ctx - Host context.
 * @param label - optional user-supplied label.
 * @returns the outcome plus the refreshed panel snapshot.
 */
async function saveCurrent(ctx, label) {
  return await autoSaveCurrent(ctx, label)
}

/**
 * Switch the active account.
 * @param ctx - Host context.
 * @param id - vault entry to activate.
 * @returns the outcome plus the refreshed panel snapshot.
 */
async function switchAccount(ctx, id) {
  const vault = await readVault(ctx)
  const account = vault.accounts.find(candidate => candidate.id === id)
  if (account === undefined) return { ok: false, error: 'not-found' }
  const issuer = await expectedIssuer(ctx)
  if (account.issuer !== issuer) {
    return { ok: false, error: 'issuer-mismatch', expected: issuer, actual: account.issuer }
  }
  const running = runningAccountTasks(ctx)
  if (running > 0) return { ok: false, error: 'running-tasks', running }
  await ctx.credentials.modifyRecord(PLATFORM_KEY, async () => ({
    kind: 'grant',
    payload: { version: 1, token: account.token, issuer: account.issuer },
  }))
  profileCache.clear()
  const now = new Date().toISOString()
  await writeVault(ctx, {
    ...vault,
    accounts: vault.accounts.map(candidate => (candidate.id === id ? { ...candidate, lastUsedAt: now } : candidate)),
  })
  return { ok: true, state: await listState(ctx) }
}

/**
 * Remove one vault entry.
 * @param ctx - Host context.
 * @param id - vault entry to remove.
 * @returns the outcome plus the refreshed panel snapshot.
 */
async function removeAccount(ctx, id) {
  const vault = await readVault(ctx)
  const next = vault.accounts.filter(account => account.id !== id)
  if (next.length === vault.accounts.length) return { ok: false, error: 'not-found' }
  await writeVault(ctx, { ...vault, accounts: next })
  return { ok: true, state: await listState(ctx) }
}

/**
 * Update an account label.
 * @param ctx - Host context.
 * @param id - account id.
 * @param rawLabel - new label text.
 */
async function updateAccountLabel(ctx, id, rawLabel) {
  const label = cleanLabel(rawLabel)
  const vault = await readVault(ctx)
  const index = vault.accounts.findIndex(a => a.id === id)
  if (index === -1) return { ok: false, error: 'not-found' }
  vault.accounts[index].label = label
  await writeVault(ctx, vault)
  return { ok: true, state: await listState(ctx) }
}

/**
 * Verify a single account by ID (identity, balance, model connectivity & latency).
 * @param ctx - Host context.
 * @param id - account id.
 */
async function verifyAccountById(ctx, id) {
  const vault = await readVault(ctx)
  const account = vault.accounts.find(a => a.id === id)
  if (account === undefined) return { ok: false, error: 'not-found' }

  const [identity, balance, probe] = await Promise.all([
    fetchIdentity(account.issuer, account.token),
    fetchBalance(account.token),
    probeModels(account.token),
  ])

  const verified = identity.ok === true && probe.ok === true
  const updatedAccounts = vault.accounts.map(candidate => {
    if (candidate.id !== id) return candidate
    return {
      ...candidate,
      verified,
      name: identity.name || candidate.name,
      contact: identity.contact || candidate.contact,
      balance: balance ?? candidate.balance,
      latencyMs: probe.latencyMs,
      models: probe.models || candidate.models,
    }
  })

  await writeVault(ctx, { ...vault, accounts: updatedAccounts })
  return {
    ok: true,
    verified,
    latencyMs: probe.latencyMs,
    balance,
    models: probe.models,
    state: await listState(ctx),
  }
}

/**
 * Verify all accounts in the vault concurrently.
 * @param ctx - Host context.
 */
async function verifyAllAccounts(ctx) {
  const vault = await readVault(ctx)
  const tasks = vault.accounts.map(async account => {
    const [identity, balance, probe] = await Promise.all([
      fetchIdentity(account.issuer, account.token),
      fetchBalance(account.token),
      probeModels(account.token),
    ])

    const verified = identity.ok === true && probe.ok === true
    return {
      ...account,
      verified,
      name: identity.name || account.name,
      contact: identity.contact || account.contact,
      balance: balance ?? account.balance,
      latencyMs: probe.latencyMs,
      models: probe.models || account.models,
    }
  })

  const updatedAccounts = await Promise.all(tasks)
  await writeVault(ctx, { ...vault, accounts: updatedAccounts })
  
  const validCount = updatedAccounts.filter(a => a.verified).length
  const invalidCount = updatedAccounts.length - validCount

  return {
    ok: true,
    valid: validCount,
    invalid: invalidCount,
    state: await listState(ctx),
  }
}

/**
 * Refresh active account balance on demand.
 * @param ctx - Host context.
 */
async function refreshActiveBalance(ctx) {
  const current = await readCurrentGrant(ctx)
  if (current === undefined) return { ok: false, error: 'signed-out' }
  const currentHash = hashToken(current.token)
  balanceCache.delete(currentHash)
  const balance = await fetchBalance(current.token)
  if (balance !== null) {
    balanceCache.set(currentHash, { at: Date.now(), value: balance })
    const vault = await readVault(ctx)
    const updated = vault.accounts.map(acc => acc.tokenHash === currentHash ? { ...acc, balance } : acc)
    await writeVault(ctx, { ...vault, accounts: updated })
  }
  return { ok: true, balance, state: await listState(ctx) }
}

/**
 * Prune all invalid accounts (verified === false) from the vault.
 * @param ctx - Host context.
 */
async function pruneInvalidAccounts(ctx) {
  const vault = await readVault(ctx)
  const remaining = vault.accounts.filter(account => account.verified !== false)
  const pruned = vault.accounts.length - remaining.length
  if (pruned > 0) {
    await writeVault(ctx, { ...vault, accounts: remaining })
  }
  return { ok: true, pruned, state: await listState(ctx) }
}

/**
 * Export accounts in selected format.
 * @param ctx - Host context.
 * @param format - 'tab' | 'json' | 'tokens'
 */
async function exportAccounts(ctx, format = 'tab') {
  const vault = await readVault(ctx)
  if (format === 'json') {
    const exported = vault.accounts.map(a => ({
      label: a.label,
      token: a.token,
      contact: a.contact,
      balance: a.balance,
      verified: a.verified,
    }))
    return { ok: true, format, content: JSON.stringify(exported, null, 2) }
  }
  if (format === 'tokens') {
    return { ok: true, format, content: vault.accounts.map(a => a.token).join('\n') }
  }
  // Default 'tab'
  const content = vault.accounts
    .map(a => `${a.label || a.contact || 'account'}\t${a.token}`)
    .join('\n')
  return { ok: true, format: 'tab', content }
}

/**
 * Get raw token for single account (for secure copying).
 * @param ctx - Host context.
 * @param id - account id.
 */
async function getAccountToken(ctx, id) {
  const vault = await readVault(ctx)
  const account = vault.accounts.find(a => a.id === id)
  if (account === undefined) return { ok: false, error: 'not-found' }
  return { ok: true, token: account.token }
}

/**
 * Import tokens from pasted text or a file.
 * @param ctx - Host context.
 * @param text - import payload in any accepted shape.
 * @returns counts plus the refreshed panel snapshot.
 */
async function importAccounts(ctx, text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'empty-import' }
  if (text.length > MAX_BODY_BYTES) return { ok: false, error: 'import-too-large' }
  const issuer = await expectedIssuer(ctx)
  const parsed = parseImport(text, issuer)
  if (parsed.entries.length === 0 && parsed.errors.length === 0) return { ok: false, error: 'no-entries' }
  const vault = await readVault(ctx)
  const known = new Set(vault.accounts.map(account => account.tokenHash))
  const added = []
  const skipped = parsed.errors.length
  const rejected = []
  
  for (const entry of parsed.entries) {
    if (added.length + vault.accounts.length >= MAX_ACCOUNTS) {
      rejected.push({ reason: 'vault-full', label: entry.label })
      continue
    }

    const tokenHash = hashToken(entry.token)
    if (known.has(tokenHash)) {
      rejected.push({ reason: 'duplicate', label: entry.label })
      continue
    }
    known.add(tokenHash)

    const [identity, balance, probe] = await Promise.all([
      fetchIdentity(entry.issuer, entry.token),
      fetchBalance(entry.token),
      probeModels(entry.token),
    ])

    if (identity.ok !== true && identity.reason === 'invalid') {
      rejected.push({ reason: 'invalid', label: entry.label })
      continue
    }

    added.push({
      id: randomUUID(),
      label: entry.label || identity.name || identity.contact || `账号 ${vault.accounts.length + added.length + 1}`,
      token: entry.token,
      tokenHash,
      issuer: entry.issuer,
      userId: identity.userId ?? '',
      name: identity.name ?? '',
      contact: identity.contact ?? '',
      verified: identity.ok === true && probe.ok === true,
      addedAt: new Date().toISOString(),
      lastUsedAt: '',
      balance,
      latencyMs: probe.latencyMs,
      models: probe.models || [],
    })
  }
  if (added.length > 0) await writeVault(ctx, { ...vault, accounts: [...vault.accounts, ...added] })
  return {
    ok: true,
    added: added.length,
    rejected,
    skipped,
    unverified: added.filter(account => !account.verified).length,
    state: await listState(ctx),
  }
}

/** @param value - raw label. @returns a trimmed, bounded label. */
function cleanLabel(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60)
}

/* ------------------------------------------------------------ import parsing */

/** Token-bearing field names accepted from JSON payloads (prioritizes dsh_token). */
const TOKEN_FIELDS = [
  'dsh_token', 'dshToken', 'x_dsh_auth_token', 'x-dsh-auth-token', 'dsh',
  'token', 'access_token', 'accessToken', 'access-token', 'authorization', 'auth', 'value', 'key'
]
/** Label-bearing field names accepted from JSON payloads. */
const LABEL_FIELDS = [
  'label', 'name', 'phone', 'mobile', 'telephone', 'contact', 'email', 'nickname', 'nickName', 'remark', 'title', 'account'
]

/**
 * Parse every supported import shape into candidate grants.
 * @param text - raw import text.
 * @param issuer - issuer assigned to entries that do not carry one.
 * @returns accepted entries and per-entry diagnostics.
 */
function parseImport(text, issuer) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseJsonImport(JSON.parse(trimmed), issuer)
    } catch {
      return { entries: [], errors: [{ reason: 'invalid-json' }] }
    }
  }
  return parseLineImport(trimmed, issuer)
}

/**
 * Parse a JSON import.
 * @param value - decoded JSON.
 * @param issuer - fallback issuer.
 * @returns accepted entries and diagnostics.
 */
function parseJsonImport(value, issuer) {
  if (Array.isArray(value)) return collectEntries(value, issuer)
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value.accounts)) return collectEntries(value.accounts, issuer)
    if (Array.isArray(value.tokens)) return collectEntries(value.tokens, issuer)
    if (looksLikeEntry(value)) return collectEntries([value], issuer)
    const mapped = []
    for (const [key, token] of Object.entries(value)) {
      if (typeof token === 'string') mapped.push({ label: key, token })
    }
    if (mapped.length > 0) return collectEntries(mapped, issuer)
  }
  return { entries: [], errors: [{ reason: 'unsupported-shape' }] }
}

/** @param value - candidate object. @returns whether it carries a token field. */
function looksLikeEntry(value) {
  return TOKEN_FIELDS.some(field => typeof value[field] === 'string')
}

/**
 * Normalize candidate objects into grants.
 * @param candidates - candidate objects.
 * @param issuer - fallback issuer.
 * @returns accepted entries and diagnostics.
 */
function collectEntries(candidates, issuer) {
  const entries = []
  const errors = []
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const token = stripBearer(candidate)
      if (!TOKEN_PATTERN.test(token)) {
        errors.push({ reason: 'invalid-token' })
        continue
      }
      entries.push({ label: '', token, issuer })
      continue
    }
    if (candidate === null || typeof candidate !== 'object') {
      errors.push({ reason: 'unsupported-shape' })
      continue
    }
    const raw = TOKEN_FIELDS.map(field => candidate[field] || candidate.credential?.[field]).find(value => typeof value === 'string')
    if (typeof raw !== 'string') {
      errors.push({ reason: 'cookie-only' in candidate || typeof candidate.cookie === 'string' ? 'cookie-only' : 'missing-token' })
      continue
    }
    const token = stripBearer(raw)
    if (!TOKEN_PATTERN.test(token)) {
      errors.push({ reason: 'invalid-token' })
      continue
    }
    const label = LABEL_FIELDS.map(field => candidate[field] || candidate.credential?.[field]).find(value => typeof value === 'string' && value !== '') ?? ''
    const entryIssuer = typeof candidate.issuer === 'string' && candidate.issuer !== ''
      ? candidate.issuer
      : typeof candidate.origin === 'string' && candidate.origin !== '' ? candidate.origin : issuer
    entries.push({ label: cleanLabel(label), token, issuer: entryIssuer })
  }
  return { entries, errors }
}

/**
 * Parse line-oriented text: `label<TAB>token`, `label token`, or a bare token per line.
 * @param text - raw text.
 * @param issuer - issuer assigned to every entry.
 * @returns accepted entries and diagnostics.
 */
function parseLineImport(text, issuer) {
  const entries = []
  const errors = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const tab = line.indexOf('\t')
    if (tab !== -1) {
      const label = cleanLabel(line.slice(0, tab))
      const token = stripBearer(line.slice(tab + 1).trim())
      if (!TOKEN_PATTERN.test(token)) {
        errors.push({ reason: 'invalid-token', label })
        continue
      }
      entries.push({ label, token, issuer })
      continue
    }
    // Colon, comma, or space separated: "label:token", "label,token", "label token"
    const delim = /^([^:,\t\s]+)[:,\s]\s*(\S+)$/.exec(line)
    if (delim !== null) {
      const label = cleanLabel(delim[1])
      const token = stripBearer(delim[2])
      if (!TOKEN_PATTERN.test(token)) {
        errors.push({ reason: 'invalid-token', label })
        continue
      }
      entries.push({ label, token, issuer })
      continue
    }
    const token = stripBearer(line)
    if (!TOKEN_PATTERN.test(token)) {
      errors.push({ reason: 'invalid-token' })
      continue
    }
    entries.push({ label: '', token, issuer })
  }
  return { entries, errors }
}

/** @param value - candidate token text. @returns the token without an optional scheme. */
function stripBearer(value) {
  return value.trim().replace(/^Bearer\s+/i, '')
}

/* ------------------------------------------------------------------- routing */

/**
 * Register the loopback route the settings page calls.
 * @param ctx - Host context.
 * @returns the route disposer.
 */
function registerRoute(ctx) {
  const server = ctx.webServer
  const selfOrigin = server.getOrigin()
  return server.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (req, res) => {
      void handleRequest(ctx, selfOrigin, req, res).catch(() => {
        sendJson(res, 500, { ok: false, error: 'internal' })
      })
    },
  })
}

/**
 * @param ctx - Host context.
 * @param selfOrigin - origin this web server serves.
 * @param req - incoming request.
 * @param res - response owner.
 */
async function handleRequest(ctx, selfOrigin, req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method' })
    return
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && !trustedOrigin(origin, selfOrigin)) {
    sendJson(res, 403, { ok: false, error: 'origin' })
    return
  }
  if (req.headers['x-account-switcher'] !== '1') {
    sendJson(res, 403, { ok: false, error: 'header' })
    return
  }
  if (!/^application\/json/i.test(req.headers['content-type'] ?? '')) {
    sendJson(res, 415, { ok: false, error: 'content-type' })
    return
  }
  const body = await readBody(req)
  if (body === undefined) {
    sendJson(res, 413, { ok: false, error: 'too-large' })
    return
  }
  let request
  try {
    request = JSON.parse(body)
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid-json' })
    return
  }
  const data = await dispatch(ctx, request)
  sendJson(res, 200, { ok: true, data })
}

/**
 * Dispatch operations.
 * @param ctx - Host context.
 * @param request - decoded request body.
 * @returns the operation result.
 */
async function dispatch(ctx, request) {
  const op = request?.op
  switch (op) {
    case 'list': return await listState(ctx)
    case 'save-current': return await saveCurrent(ctx, request.label)
    case 'switch': return await switchAccount(ctx, String(request.id ?? ''))
    case 'remove': return await removeAccount(ctx, String(request.id ?? ''))
    case 'import': return await importAccounts(ctx, request.text)
    case 'verify': return await verifyAccountById(ctx, String(request.id ?? ''))
    case 'verify-all': return await verifyAllAccounts(ctx)
    case 'refresh-balance': return await refreshActiveBalance(ctx)
    case 'update-label': return await updateAccountLabel(ctx, String(request.id ?? ''), String(request.label ?? ''))
    case 'prune-invalid': return await pruneInvalidAccounts(ctx)
    case 'export': return await exportAccounts(ctx, request.format)
    case 'get-token': return await getAccountToken(ctx, String(request.id ?? ''))
    default: return { ok: false, error: 'unknown-op' }
  }
}

/**
 * @param origin - request Origin header.
 * @param selfOrigin - origin this web server serves.
 * @returns whether the request came from a page on this loopback server.
 */
function trustedOrigin(origin, selfOrigin) {
  try {
    const request = new URL(origin)
    const self = new URL(selfOrigin)
    return LOOPBACK_HOSTS.includes(request.hostname) && request.port === self.port
  } catch {
    return false
  }
}

/**
 * @param req - incoming request.
 * @returns the UTF-8 body, or undefined past the size limit.
 */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      req.destroy()
      return undefined
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * @param res - response owner.
 * @param status - HTTP status.
 * @param payload - JSON body.
 */
function sendJson(res, status, payload) {
  if (res.headersSent) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}
