/**
 * Client half of the account switcher: settings page listing the local
 * account vault with one-click switch, real-time balance display, full-account
 * health check & verification, label editing, and export capabilities.
 */

window.__ModuleLoader__.load({
  id: '@local/account-switcher',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'accountSwitcher'
    const API = '/account-switcher/api'

    /** Simplified Chinese dictionary (key-set source of truth). */
    const zh = {
      'nav': '账号切换',
      'intro': '把多个账号的凭据保存在本地，点一下即可切换。切换只替换当前凭据记录，下一条模型请求就用新账号。',
      'loading': '加载中…',
      'retry': '重试',
      'currentTitle': '当前活跃账号',
      'signedOut': '未登录',
      'notInList': '尚未保存到列表',
      'saveCurrent': '保存当前账号',
      'saved': '已保存 {count} 个账号',
      'empty': '列表里还没有账号。登录一个账号后点“保存当前账号”，或直接导入 token。',
      'switch': '切换',
      'current': '当前',
      'verified': '已验证',
      'unverified': '未验证',
      'remove': '移除',
      'importTitle': '导入账号',
      'importHint': '支持直接粘贴文本或上传账号文件（.json、.txt、.tsv）。支持 3 种输入形态：① 文本行：标签与 Token（支持 TAB、冒号、逗号或空格分隔）；② 纯 Token 列表（每行一个）；③ JSON 格式：支持标准对象数组 [{"label": "...", "token": "..."}]、包含 accounts 列表的 JSON 文件，或键值对映射 {"账号": "token"}。',
      'importPlaceholder': '# 格式 1：文本行（标签与 Token，支持 TAB/冒号/逗号/空格分隔）\nuser1@example.com\tnhLfUn5P...\n13800138000:icjzqmMT...\n\n# 格式 2：纯 Token 列表（每行一个）\nnhLfUn5P...\n\n# 格式 3：标准 JSON（对象数组或键值字典）\n[\n  { "label": "工作账号", "token": "..." }\n]',
      'chooseFile': '选择文件',
      'importRun': '开始导入',
      'cancel': '取消',
      'running': '有 {count} 个任务正在使用账号凭据，等它们结束后再切换。',
      'switchOk': '已切换到 {label}',
      'savedOk': '已保存当前账号',
      'savedDuplicate': '当前账号已在列表中',
      'removedOk': '已从列表移除（未退出登录）',
      'importedOk': '导入完成：新增 {added} 个',
      'importedPartial': '导入完成：新增 {added} 个，跳过 {rejected} 个',
      'errSignedOut': '当前没有已登录的账号',
      'errRunningTasks': '有任务正在使用账号凭据，暂不切换',
      'errIssuerMismatch': '该账号的签发来源是 {actual}，与当前平台来源 {expected} 不一致',
      'errNotFound': '该账号已不在列表中',
      'errInvalid': 'token 被平台拒绝（可能已失效）',
      'errDuplicate': 'token 已在列表中',
      'errVaultFull': '列表已达上限（{max} 个）',
      'errCookieOnly': 'cookie 不是 DSH 使用的凭据，请提供 x-dsh-auth-token 的值',
      'errEmptyImport': '没有可导入的内容',
      'errNoEntries': '没有解析出任何账号',
      'errImportTooLarge': '导入内容过大',
      'errInvalidJson': 'JSON 格式错误',
      'errUnsupported': '无法识别的格式',
      'errMissingToken': '缺少 token 字段',
      'errInvalidToken': 'token 格式不合法',
      'errGeneric': '操作失败：{reason}',
      
      // Extensions:
      'balance': '余额',
      'granted': '赠送',
      'toppedUp': '充值',
      'refreshBalance': '刷新余额',
      'refreshedBalance': '余额已更新',
      'verifyAll': '一键测活',
      'verifying': '检测中…',
      'verify': '测活',
      'verifyOk': '全量检测完成：{valid} 个可用，{invalid} 个失效',
      'editLabel': '修改备注',
      'save': '保存',
      'copyToken': '复制 Token',
      'copied': '已复制到剪贴板',
      'exportTitle': '导出账号',
      'exportHint': '可复制全部账号数据，方便跨环境备份或重新导入：',
      'copyAll': '一键复制',
      'pruneInvalid': '清理失效',
      'prunedOk': '已清理 {count} 个失效账号',
      'noInvalid': '列表中无失效账号',
      'latency': '延迟',
      'models': '模型',
      'available': '可用',
      'exhausted': '已耗尽',
      'autoSaved': '已自动保存到本地列表',
      'autoSaving': '正在自动保存…',
    }

    /** English dictionary. */
    const en = {
      'nav': 'Accounts',
      'intro': 'Keep several accounts in a local vault and switch with one click. Switching replaces the stored credential record, so the next model request uses the new account.',
      'loading': 'Loading…',
      'retry': 'Retry',
      'currentTitle': 'Active Account',
      'signedOut': 'Not signed in',
      'notInList': 'Not saved to the list yet',
      'saveCurrent': 'Save current account',
      'saved': '{count} saved account(s)',
      'empty': 'No accounts saved yet. Sign in, then use “Save current account”, or import tokens directly.',
      'switch': 'Switch',
      'current': 'Current',
      'verified': 'Verified',
      'unverified': 'Unverified',
      'remove': 'Remove',
      'removeConfirm': 'Confirm remove',
      'importTitle': 'Import',
      'importHint': 'Paste text or upload account files (.json, .txt, .tsv). Supported shapes: 1) Lines: Label and Token (separated by TAB, colon, comma, or space); 2) Bare Tokens: one per line; 3) Standard JSON: array of objects [{"label": "...", "token": "..."}], JSON with an "accounts" list, or key-value map {"account": "token"}.',
      'importPlaceholder': '# Format 1: Text lines (Label and Token separated by TAB/colon/comma/space)\nuser1@example.com\tnhLfUn5P...\n13800138000:icjzqmMT...\n\n# Format 2: Bare token per line\nnhLfUn5P...\n\n# Format 3: Standard JSON (object array or key-value map)\n[\n  { "label": "work-account", "token": "..." }\n]',
      'chooseFile': 'Choose file',
      'importRun': 'Import',
      'cancel': 'Cancel',
      'running': '{count} running task(s) are using the account credential; switch after they finish.',
      'switchOk': 'Switched to {label}',
      'savedOk': 'Current account saved',
      'savedDuplicate': 'The current account is already in the list',
      'removedOk': 'Removed from the list (still signed in)',
      'importedOk': 'Imported {added} account(s)',
      'importedPartial': 'Imported {added} account(s), skipped {rejected}',
      'errSignedOut': 'No account is currently signed in',
      'errRunningTasks': 'A running task is using the account credential; switching is refused',
      'errIssuerMismatch': 'That account was issued by {actual}, which does not match current platform origin {expected}',
      'errNotFound': 'That account is no longer in the list',
      'errInvalid': 'Platform rejected the token (it may have expired)',
      'errDuplicate': 'That token is already in the list',
      'errVaultFull': 'The list is full ({max} accounts)',
      'errCookieOnly': 'A cookie is not a DSH credential; supply the x-dsh-auth-token value instead',
      'errEmptyImport': 'Nothing to import',
      'errNoEntries': 'No account could be parsed',
      'errImportTooLarge': 'The import payload is too large',
      'errInvalidJson': 'Malformed JSON',
      'errUnsupported': 'Unrecognized format',
      'errMissingToken': 'No token field',
      'errInvalidToken': 'Malformed token',
      'errGeneric': 'Failed: {reason}',

      // Extensions:
      'balance': 'Balance',
      'granted': 'Granted',
      'toppedUp': 'Topped up',
      'refreshBalance': 'Refresh balance',
      'refreshedBalance': 'Balance updated',
      'verifyAll': 'Verify All',
      'verifying': 'Verifying…',
      'verify': 'Verify',
      'verifyOk': 'Health check completed: {valid} valid, {invalid} invalid',
      'editLabel': 'Edit remark',
      'save': 'Save',
      'copyToken': 'Copy Token',
      'copied': 'Copied to clipboard',
      'exportTitle': 'Export',
      'exportHint': 'Export accounts for backup or cross-device migration:',
      'copyAll': 'Copy All',
      'pruneInvalid': 'Prune Dead',
      'prunedOk': 'Removed {count} invalid account(s)',
      'noInvalid': 'No invalid accounts in list',
      'latency': 'Latency',
      'models': 'Models',
      'available': 'Available',
      'exhausted': 'Exhausted',
      'autoSaved': 'Auto-saved to local vault',
      'autoSaving': 'Auto-saving to vault…',
    }

    const MAX_ACCOUNTS = 50

    /**
     * Call one Host operation.
     * @param op - operation name.
     * @param payload - additional fields.
     * @returns the decoded result body.
     */
    async function call(op, payload) {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-account-switcher': '1' },
        body: JSON.stringify({ op, ...payload }),
      })
      const body = await response.json().catch(() => null)
      if (body === null) throw new Error(`HTTP ${response.status}`)
      return body
    }

    const CSS = `
.dsh-as-section { display: flex; flex-direction: column; gap: 16px; padding: 8px 0; font-size: 13px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.dsh-as-intro { margin: 0; color: var(--dsw-alias-label-secondary); }
.dsh-as-card { padding: 14px 18px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.dsh-as-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
.dsh-as-card-title { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.dsh-as-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-as-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 8px 0; }
.dsh-as-row + .dsh-as-row { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.dsh-as-identity { display: flex; flex-direction: column; min-width: 0; gap: 3px; flex: 1; }
.dsh-as-label-row { display: flex; align-items: center; gap: 8px; }
.dsh-as-label { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-as-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-as-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dsh-as-actions { display: flex; align-items: center; gap: 6px; flex: none; flex-wrap: wrap; }

.dsh-as-badge { padding: 2px 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 500; }
.dsh-as-badge-current { color: var(--dsw-alias-state-success-primary); background: rgba(16, 185, 129, 0.12); font-weight: 600; }
.dsh-as-badge-unverified { color: var(--dsw-alias-state-warn-primary); background: rgba(245, 158, 11, 0.12); }
.dsh-as-badge-balance { color: #10b981; background: rgba(16, 185, 129, 0.12); font-weight: 600; }
.dsh-as-badge-latency { color: #3b82f6; background: rgba(59, 130, 246, 0.1); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dsh-as-badge-models { color: #8b5cf6; background: rgba(139, 92, 246, 0.1); font-size: 10px; }

.dsh-as-balance-block { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; padding: 10px 14px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.dsh-as-balance-val { font-size: 20px; font-weight: 700; color: #10b981; }
.dsh-as-balance-details { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-left: 8px; }

.dsh-as-btn { height: 32px; min-width: 52px; padding: 0 12px; box-sizing: border-box; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.15s ease; }
.dsh-as-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-as-btn:disabled { color: var(--dsw-alias-state-idle-primary); cursor: default; opacity: 0.6; }
.dsh-as-btn-sm { height: 26px; padding: 0 8px; font-size: 12px; border-radius: 6px; }
.dsh-as-btn-primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsh-as-btn-danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.dsh-as-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

.dsh-as-edit-input { height: 26px; padding: 0 8px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; }
.dsh-as-edit-input:focus { outline: 2px solid var(--dsw-alias-brand-primary); }

.dsh-as-empty { color: var(--dsw-alias-label-secondary); }
.dsh-as-note { color: var(--dsw-alias-state-warn-primary); margin: 6px 0 0; }
.dsh-as-error { color: var(--dsw-alias-state-error-primary); }
.dsh-as-ok { color: var(--dsw-alias-state-success-primary); }
.dsh-as-textarea { width: 100%; min-height: 128px; box-sizing: border-box; padding: 8px 10px; resize: vertical; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 18px; }
.dsh-as-textarea:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-as-import-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.dsh-as-file { display: none; }
.dsh-as-rejected { margin: 8px 0 0; padding-left: 18px; color: var(--dsw-alias-label-secondary); }
`

    /**
     * Render one account row.
     */
    function AccountRow({ t, account, busy, onSwitch, onRemove, onVerify, onUpdateLabel, onCopyToken }) {
      const [confirming, setConfirming] = React.useState(false)
      const [editing, setEditing] = React.useState(false)
      const [labelDraft, setLabelDraft] = React.useState(account.label)

      React.useEffect(() => {
        if (!confirming) return undefined
        const timer = setTimeout(() => { setConfirming(false) }, 4000)
        return () => { clearTimeout(timer) }
      }, [confirming])

      const display = account.label || account.name || account.contact || account.tokenHint

      return h('div', { className: 'dsh-as-row' },
        h('div', { className: 'dsh-as-identity' },
          editing
            ? h('div', { className: 'dsh-as-label-row' },
                h('input', {
                  className: 'dsh-as-edit-input',
                  value: labelDraft,
                  onChange: e => setLabelDraft(e.target.value),
                  onKeyDown: e => {
                    if (e.key === 'Enter') {
                      onUpdateLabel(account.id, labelDraft)
                      setEditing(false)
                    } else if (e.key === 'Escape') {
                      setEditing(false)
                    }
                  },
                  autoFocus: true,
                }),
                h('button', {
                  type: 'button',
                  className: 'dsh-as-btn dsh-as-btn-sm dsh-as-btn-primary',
                  onClick: () => {
                    onUpdateLabel(account.id, labelDraft)
                    setEditing(false)
                  },
                }, t('save')),
                h('button', {
                  type: 'button',
                  className: 'dsh-as-btn dsh-as-btn-sm',
                  onClick: () => setEditing(false),
                }, t('cancel')),
              )
            : h('div', { className: 'dsh-as-label-row' },
                h('span', { className: 'dsh-as-label' }, display),
                h('button', {
                  type: 'button',
                  className: 'dsh-as-btn dsh-as-btn-sm',
                  style: { height: '20px', padding: '0 4px', fontSize: '11px', border: 'none', color: 'var(--dsw-alias-label-secondary)' },
                  title: t('editLabel'),
                  onClick: () => {
                    setLabelDraft(account.label || display)
                    setEditing(true)
                  },
                }, '✏️'),
              ),
          h('div', { className: 'dsh-as-meta' },
            account.label && (account.name || account.contact) ? h('span', {}, account.name || account.contact) : null,
            h('span', { className: 'dsh-as-mono' }, account.tokenHint),
            account.balance
              ? h('span', {
                  className: 'dsh-as-badge dsh-as-badge-balance',
                  title: `${t('granted')}: ¥${account.balance.granted} / ${t('toppedUp')}: ¥${account.balance.toppedUp}`,
                }, `¥${account.balance.total}`)
              : null,
            typeof account.latencyMs === 'number'
              ? h('span', { className: 'dsh-as-badge dsh-as-badge-latency' }, `${account.latencyMs}ms`)
              : null,
            account.models && account.models.length > 0
              ? h('span', { className: 'dsh-as-badge dsh-as-badge-models' }, account.models.map(m => m.replace('deepseek-', '')).join('/'))
              : null,
            account.verified
              ? h('span', { className: 'dsh-as-badge' }, t('verified'))
              : h('span', { className: 'dsh-as-badge dsh-as-badge-unverified' }, t('unverified')),
            account.current ? h('span', { className: 'dsh-as-badge dsh-as-badge-current' }, t('current')) : null,
          ),
        ),
        h('div', { className: 'dsh-as-actions' },
          account.current
            ? null
            : h('button', {
                type: 'button',
                className: 'dsh-as-btn dsh-as-btn-sm dsh-as-btn-primary',
                disabled: busy !== '',
                onClick: () => { onSwitch(account.id) },
              }, t('switch')),
          h('button', {
            type: 'button',
            className: 'dsh-as-btn dsh-as-btn-sm',
            disabled: busy !== '',
            title: t('verify'),
            onClick: () => { onVerify(account.id) },
          }, t('verify')),
          h('button', {
            type: 'button',
            className: 'dsh-as-btn dsh-as-btn-sm',
            disabled: busy !== '',
            title: t('copyToken'),
            onClick: () => { onCopyToken(account.id) },
          }, '📋'),
          h('button', {
            type: 'button',
            className: confirming ? 'dsh-as-btn dsh-as-btn-sm dsh-as-btn-danger' : 'dsh-as-btn dsh-as-btn-sm',
            disabled: busy !== '',
            onClick: () => {
              if (confirming) { setConfirming(false); onRemove(account.id) } else setConfirming(true)
            },
          }, confirming ? t('removeConfirm') : t('remove')),
        ),
      )
    }

    /**
     * Render the account switcher settings page.
     */
    function AccountSwitcherSection({ t }) {
      const [phase, setPhase] = React.useState('loading')
      const [snapshot, setSnapshot] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [message, setMessage] = React.useState(null)
      const [importOpen, setImportOpen] = React.useState(false)
      const [exportOpen, setExportOpen] = React.useState(false)
      const [exportText, setExportText] = React.useState('')
      const [exportFormat, setExportFormat] = React.useState('tab')
      const [draft, setDraft] = React.useState('')
      const [rejected, setRejected] = React.useState([])
      const fileRef = React.useRef(null)

      const refresh = React.useCallback(async () => {
        const body = await call('list')
        if (body.ok !== true) throw new Error(body.error ?? 'list')
        setSnapshot(body.data)
        setPhase('ready')
      }, [])

      React.useEffect(() => {
        let live = true
        refresh().catch(() => { if (live) setPhase('failed') })
        return () => { live = false }
      }, [refresh])

      const describeError = (reason, extra = {}) => {
        switch (reason) {
          case 'signed-out': return t('errSignedOut')
          case 'running-tasks': return t('errRunningTasks')
          case 'issuer-mismatch': return t('errIssuerMismatch', { actual: extra.actual ?? '', expected: extra.expected ?? '' })
          case 'not-found': return t('errNotFound')
          case 'invalid': return t('errInvalid')
          case 'duplicate': return t('errDuplicate')
          case 'vault-full': return t('errVaultFull', { max: MAX_ACCOUNTS })
          case 'cookie-only': return t('errCookieOnly')
          case 'empty-import': return t('errEmptyImport')
          case 'no-entries': return t('errNoEntries')
          case 'import-too-large': return t('errImportTooLarge')
          case 'invalid-json': return t('errInvalidJson')
          case 'unsupported-shape': return t('errUnsupported')
          case 'missing-token': return t('errMissingToken')
          case 'invalid-token': return t('errInvalidToken')
          default: return t('errGeneric', { reason: String(reason) })
        }
      }

      const run = async (key, operation) => {
        setBusy(key)
        setMessage(null)
        try {
          const result = await operation()
          if (result.ok !== true) {
            setMessage({ kind: 'error', text: describeError(result.error, result) })
          }
          if (result.state !== undefined) setSnapshot(result.state)
          return result
        } catch (error) {
          setMessage({ kind: 'error', text: describeError('internal', { reason: error instanceof Error ? error.message : String(error) }) })
          return { ok: false }
        } finally {
          setBusy('')
        }
      }

      const handleExport = async (format = 'tab') => {
        setExportFormat(format)
        const res = await call('export', { format })
        if (res.ok && res.data?.ok) {
          setExportText(res.data.content)
          setExportOpen(true)
          setImportOpen(false)
        }
      }

      if (phase === 'loading') {
        return h('section', { className: 'dsh-as-section', 'aria-label': t('nav') },
          h('style', {}, CSS),
          h('p', { className: 'dsh-as-intro' }, t('loading')))
      }
      if (phase === 'failed' || snapshot === null) {
        return h('section', { className: 'dsh-as-section', 'aria-label': t('nav') },
          h('style', {}, CSS),
          h('p', { className: 'dsh-as-error' }, describeError('internal', { reason: 'list' })),
          h('div', { className: 'dsh-as-import-actions' },
            h('button', { type: 'button', className: 'dsh-as-btn', onClick: () => { setPhase('loading'); refresh().catch(() => { setPhase('failed') }) } }, t('retry'))))
      }

      const accounts = snapshot.accounts ?? []
      const current = snapshot.current
      const invalidCount = accounts.filter(a => !a.verified).length

      return h('section', { className: 'dsh-as-section', 'aria-label': t('nav') },
        h('style', {}, CSS),
        h('p', { className: 'dsh-as-intro' }, t('intro')),

        // Card 1: Active Account
        h('div', { className: 'dsh-as-card' },
          h('div', { className: 'dsh-as-card-head' },
            h('span', { className: 'dsh-as-card-title' },
              '🌟 ', t('currentTitle'),
            ),
            h('div', { className: 'dsh-as-toolbar' },
              snapshot.signedIn && current !== null
                ? (current.accountId !== ''
                    ? h('span', { className: 'dsh-as-badge dsh-as-badge-current', style: { padding: '4px 10px' } }, '✅ ' + t('autoSaved'))
                    : h('span', { className: 'dsh-as-badge dsh-as-badge-unverified', style: { padding: '4px 10px' } }, '⏳ ' + t('autoSaving')))
                : null,
              snapshot.signedIn
                ? h('button', {
                    type: 'button',
                    className: 'dsh-as-btn dsh-as-btn-sm',
                    disabled: busy !== '',
                    onClick: () => {
                      void run('refresh-balance', async () => {
                        const result = await call('refresh-balance')
                        if (result.ok === true) setMessage({ kind: 'ok', text: t('refreshedBalance') })
                        return result.data
                      })
                    },
                  }, '🔄 ' + t('refreshBalance'))
                : null,
            ),
          ),
          h('div', { className: 'dsh-as-row' },
            h('div', { className: 'dsh-as-identity' },
              h('span', { className: 'dsh-as-label' },
                snapshot.signedIn
                  ? (current?.label || current?.name || current?.contact || current?.tokenHint || t('current'))
                  : t('signedOut')),
              current !== null
                ? h('span', { className: 'dsh-as-meta' },
                    current.label && (current.name || current.contact) ? h('span', {}, current.name || current.contact) : null,
                    h('span', { className: 'dsh-as-mono' }, current.tokenHint),
                    current.accountId === '' ? h('span', {}, '⏳ ' + t('autoSaving')) : null,
                    current.models && current.models.length > 0
                      ? h('span', { className: 'dsh-as-badge dsh-as-badge-models' }, current.models.join(', '))
                      : null,
                  )
                : null,
            ),
          ),
          // Balance Display Block
          snapshot.signedIn && current?.balance
            ? h('div', { className: 'dsh-as-balance-block' },
                h('div', { style: { display: 'flex', alignItems: 'baseline' } },
                  h('span', { style: { fontSize: '13px', fontWeight: 600, marginRight: '8px' } }, t('balance') + ':'),
                  h('span', { className: 'dsh-as-balance-val' }, `¥ ${current.balance.total}`),
                  h('span', { className: 'dsh-as-balance-details' },
                    `(${t('granted')}: ¥${current.balance.granted} / ${t('toppedUp')}: ¥${current.balance.toppedUp})`),
                ),
                h('span', {
                  className: 'dsh-as-badge dsh-as-badge-balance',
                  style: { padding: '4px 10px', fontSize: '12px' },
                }, current.balance.isAvailable ? '✅ ' + t('available') : '⚠️ ' + t('exhausted')),
              )
            : null,
          snapshot.runningTasks > 0
            ? h('p', { className: 'dsh-as-note' }, t('running', { count: snapshot.runningTasks }))
            : null,
        ),

        // Card 2: Vault Accounts
        h('div', { className: 'dsh-as-card' },
          h('div', { className: 'dsh-as-card-head' },
            h('span', { className: 'dsh-as-card-title' },
              '📁 ', t('saved', { count: accounts.length }),
            ),
            h('div', { className: 'dsh-as-toolbar' },
              h('button', {
                type: 'button',
                className: 'dsh-as-btn dsh-as-btn-sm dsh-as-btn-primary',
                disabled: busy !== '' || accounts.length === 0,
                onClick: () => {
                  void run('verify-all', async () => {
                    const result = await call('verify-all')
                    if (result.ok === true) {
                      setMessage({ kind: 'ok', text: t('verifyOk', { valid: result.data.valid, invalid: result.data.invalid }) })
                    }
                    return result.data
                  })
                },
              }, busy === 'verify-all' ? t('verifying') : '⚡ ' + t('verifyAll')),
              h('button', {
                type: 'button',
                className: 'dsh-as-btn dsh-as-btn-sm',
                onClick: () => { setImportOpen(v => !v); setExportOpen(false); setMessage(null) },
              }, '📥 ' + t('importTitle')),
              h('button', {
                type: 'button',
                className: 'dsh-as-btn dsh-as-btn-sm',
                disabled: accounts.length === 0,
                onClick: () => handleExport('tab'),
              }, '📤 ' + t('exportTitle')),
              invalidCount > 0
                ? h('button', {
                    type: 'button',
                    className: 'dsh-as-btn dsh-as-btn-sm dsh-as-btn-danger',
                    disabled: busy !== '',
                    onClick: () => {
                      void run('prune-invalid', async () => {
                        const result = await call('prune-invalid')
                        if (result.ok === true) {
                          setMessage({ kind: 'ok', text: t('prunedOk', { count: result.data.pruned }) })
                        }
                        return result.data
                      })
                    },
                  }, '🧹 ' + t('pruneInvalid') + ` (${invalidCount})`)
                : null,
            ),
          ),

          // Export Panel
          exportOpen
            ? h('div', { style: { padding: '10px 0', borderBottom: '0.5px solid var(--dsw-alias-border-l1)', marginBottom: '8px' } },
                h('p', { className: 'dsh-as-empty', style: { margin: '0 0 8px' } }, t('exportHint')),
                h('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px' } },
                  h('button', {
                    type: 'button',
                    className: exportFormat === 'tab' ? 'dsh-as-btn dsh-as-btn-sm dsh-as-btn-primary' : 'dsh-as-btn dsh-as-btn-sm',
                    onClick: () => handleExport('tab'),
                  }, '制表符 (Tab)'),
                  h('button', {
                    type: 'button',
                    className: exportFormat === 'tokens' ? 'dsh-as-btn dsh-as-btn-sm dsh-as-btn-primary' : 'dsh-as-btn dsh-as-btn-sm',
                    onClick: () => handleExport('tokens'),
                  }, '纯 Token'),
                  h('button', {
                    type: 'button',
                    className: exportFormat === 'json' ? 'dsh-as-btn dsh-as-btn-sm dsh-as-btn-primary' : 'dsh-as-btn dsh-as-btn-sm',
                    onClick: () => handleExport('json'),
                  }, 'JSON'),
                ),
                h('textarea', {
                  className: 'dsh-as-textarea',
                  value: exportText,
                  readOnly: true,
                  rows: 5,
                }),
                h('div', { className: 'dsh-as-import-actions' },
                  h('button', {
                    type: 'button',
                    className: 'dsh-as-btn dsh-as-btn-sm dsh-as-btn-primary',
                    onClick: () => {
                      navigator.clipboard.writeText(exportText).then(() => {
                        setMessage({ kind: 'ok', text: t('copied') })
                      })
                    },
                  }, '📋 ' + t('copyAll')),
                  h('button', {
                    type: 'button',
                    className: 'dsh-as-btn dsh-as-btn-sm',
                    onClick: () => setExportOpen(false),
                  }, t('cancel')),
                ),
              )
            : null,

          // Import Panel
          importOpen
            ? h('div', { style: { padding: '10px 0', borderBottom: '0.5px solid var(--dsw-alias-border-l1)', marginBottom: '8px' } },
                h('p', { className: 'dsh-as-empty', style: { margin: '0 0 8px' } }, t('importHint')),
                h('textarea', {
                  className: 'dsh-as-textarea',
                  value: draft,
                  placeholder: t('importPlaceholder'),
                  spellCheck: false,
                  onChange: event => { setDraft(event.target.value) },
                }),
                h('div', { className: 'dsh-as-import-actions' },
                  h('input', {
                    ref: fileRef,
                    type: 'file',
                    accept: '.txt,.json,.yaml,.yml,text/plain,application/json',
                    className: 'dsh-as-file',
                    onChange: event => {
                      const file = event.target.files?.[0]
                      if (file === undefined) return
                      void file.text().then(text => { setDraft(text) })
                      event.target.value = ''
                    },
                  }),
                  h('button', { type: 'button', className: 'dsh-as-btn dsh-as-btn-sm', disabled: busy !== '', onClick: () => { fileRef.current?.click() } }, t('chooseFile')),
                  h('button', {
                    type: 'button',
                    className: 'dsh-as-btn dsh-as-btn-sm dsh-as-btn-primary',
                    disabled: busy !== '' || draft.trim() === '',
                    onClick: () => {
                      void run('import', async () => {
                        const result = await call('import', { text: draft })
                        if (result.ok === true) {
                          const data = result.data
                          setRejected(data.rejected ?? [])
                          setDraft('')
                          setMessage({
                            kind: 'ok',
                            text: data.rejected.length > 0
                              ? t('importedPartial', { added: data.added, rejected: data.rejected.length })
                              : t('importedOk', { added: data.added }),
                          })
                        }
                        return result.data
                      })
                    },
                  }, t('importRun')),
                  h('button', { type: 'button', className: 'dsh-as-btn dsh-as-btn-sm', onClick: () => { setImportOpen(false); setRejected([]) } }, t('cancel')),
                ),
                rejected.length > 0
                  ? h('ul', { className: 'dsh-as-rejected' },
                      rejected.map((item, index) => h('li', { key: index }, `${item.label ? `${item.label}: ` : ''}${describeError(item.reason, item)}`)))
                  : null,
              )
            : null,

          // Account Rows
          accounts.length === 0
            ? h('p', { className: 'dsh-as-empty' }, t('empty'))
            : accounts.map(account => h(AccountRow, {
                key: account.id,
                t,
                account,
                busy,
                onSwitch: (id) => {
                  void run('switch', async () => {
                    const result = await call('switch', { id })
                    if (result.ok === true) {
                      const label = (result.data.accounts ?? []).find(item => item.id === id)?.label
                        ?? (result.data.current?.label || result.data.current?.name || '')
                      setMessage({ kind: 'ok', text: t('switchOk', { label }) })
                    }
                    return result.data
                  })
                },
                onVerify: (id) => {
                  void run('verify', async () => {
                    const result = await call('verify', { id })
                    if (result.ok === true) {
                      setMessage({ kind: 'ok', text: `账号已检测 (${result.data.latencyMs}ms, 余额: ¥${result.data.balance?.total ?? '--'})` })
                    }
                    return result.data
                  })
                },
                onUpdateLabel: (id, label) => {
                  void run('update-label', async () => {
                    const result = await call('update-label', { id, label })
                    if (result.ok === true) setMessage({ kind: 'ok', text: '备注已更新' })
                    return result.data
                  })
                },
                onCopyToken: async (id) => {
                  const res = await call('get-token', { id })
                  if (res.ok && res.data?.token) {
                    navigator.clipboard.writeText(res.data.token).then(() => {
                      setMessage({ kind: 'ok', text: t('copied') })
                    })
                  }
                },
                onRemove: (id) => {
                  void run('remove', async () => {
                    const result = await call('remove', { id })
                    if (result.ok === true) setMessage({ kind: 'ok', text: t('removedOk') })
                    return result.data
                  })
                },
              })),
        ),

        message !== null
          ? h('p', { className: message.kind === 'ok' ? 'dsh-as-ok' : 'dsh-as-error', style: { padding: '4px 0', margin: '4px 0' } }, message.text)
          : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'account-switcher: dictionaries')
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'account-switcher',
          order: 25,
          label: () => t('nav'),
          locale: NS,
        }, AccountSwitcherSection)), 'account-switcher: settings page')
      },
    }
  },
})
