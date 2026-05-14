export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { ComposioToolSet } from 'composio-core'

interface ComposioRequest {
  sessionId: string
  concept: string
  gap: string
  question: string
  hint: string
  /** Per-user Notion parent page or database UUID (each workspace has its own IDs). */
  notionParentId?: string
}

type ComposioPostResult =
  | { success: true }
  | { success: false; error: string }
  | { success: false; requiresAuth: true; authUrl: string }

function jsonResult(body: ComposioPostResult) {
  return NextResponse.json(body, { status: 200 })
}

function parseBody(raw: unknown): ComposioRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.sessionId !== 'string') return null
  if (typeof o.concept !== 'string') return null
  if (typeof o.gap !== 'string') return null
  if (typeof o.question !== 'string') return null
  if (typeof o.hint !== 'string') return null
  const notionParentId =
    typeof o.notionParentId === 'string' && o.notionParentId.trim().length > 0
      ? o.notionParentId.trim()
      : undefined
  return {
    sessionId: o.sessionId,
    concept: o.concept,
    gap: o.gap,
    question: o.question,
    hint: o.hint,
    ...(notionParentId ? { notionParentId } : {}),
  }
}

function composioBackendBase(): string {
  const raw = process.env.COMPOSIO_BASE_URL?.trim()
  if (!raw) return 'https://backend.composio.dev'
  return raw.replace(/\/+$/, '')
}

/**
 * Composio-managed OAuth: legacy initiate() returns 400 after 2026-05-08.
 * Use hosted link API — one link per user_id (we use browser sessionId).
 * @see https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink
 */
async function requestHostedNotionLink(input: {
  apiKey: string
  userId: string
  callbackUrl: string
}): Promise<{ ok: true; redirectUrl: string } | { ok: false; error: string }> {
  const authConfigId = process.env.COMPOSIO_NOTION_AUTH_CONFIG_ID?.trim()
  if (!authConfigId) {
    return {
      ok: false,
      error:
        'Server is missing COMPOSIO_NOTION_AUTH_CONFIG_ID. In Composio (https://platform.composio.dev) open Auth configs → create a Notion auth config → copy its id into .env. Each end-user still gets their own Notion workspace: user_id is your sessionId.',
    }
  }

  const url = `${composioBackendBase()}/api/v3.1/connected_accounts/link`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.apiKey,
      },
      body: JSON.stringify({
        auth_config_id: authConfigId,
        user_id: input.userId,
        callback_url: input.callbackUrl,
      }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error calling Composio'
    return { ok: false, error: msg }
  }

  let data: unknown
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    if (typeof data === 'object' && data !== null && 'error' in data) {
      const err = (data as { error: unknown }).error
      if (typeof err === 'object' && err !== null) {
        const o = err as Record<string, unknown>
        const msg = typeof o.message === 'string' ? o.message : ''
        const fix = typeof o.suggested_fix === 'string' ? o.suggested_fix : ''
        detail = [msg, fix].filter(Boolean).join(' ') || JSON.stringify(err).slice(0, 400)
      } else if (typeof err === 'string') {
        detail = err
      }
    }
    return {
      ok: false,
      error: `Could not start Notion connect link (${res.status}): ${detail}`,
    }
  }

  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as { redirect_url?: unknown }).redirect_url !== 'string' ||
    !(data as { redirect_url: string }).redirect_url.trim()
  ) {
    return {
      ok: false,
      error: 'Composio link response missing redirect_url.',
    }
  }

  return { ok: true, redirectUrl: (data as { redirect_url: string }).redirect_url.trim() }
}

function clarifyComposioError(message: string, userId: string): string {
  const m = message.toLowerCase()
  const setupHint = `Per-user Notion: Composio stores connections by user_id (this app uses your session id "${userId}"). Set COMPOSIO_NOTION_AUTH_CONFIG_ID (Notion auth config in Composio) and COMPOSIO_API_KEY on the server — each user completes OAuth once via "Save to Notion".`

  if (m.includes('api_key') || m.includes('unauthorized') || m.includes('401')) {
    return 'Composio rejected the request (check COMPOSIO_API_KEY in .env).'
  }
  if (
    m.includes('connected') ||
    m.includes('connection') ||
    m.includes('no account') ||
    m.includes('not connected') ||
    m.includes('oauth') ||
    m.includes('integrate') ||
    m.includes('reauth') ||
    m.includes('bad request') ||
    m.includes('malformed')
  ) {
    return `${message.trim()} ${setupHint}`
  }
  if (m.includes('found with title')) {
    return `${message.trim()} If you pasted a page ID from a Notion URL, use the 32-character hex block (with or without hyphens) or paste the full page URL — the server converts dashless IDs to a real UUID for Notion.`
  }
  if (m.includes('notion')) {
    return `${message.trim()} ${setupHint}`
  }
  if (m.includes('api not found') || m.includes('could not find action')) {
    return `${message.trim()} Composio renamed tools: use action NOTION_CREATE_NOTION_PAGE (not NOTION_CREATE_A_PAGE). Set COMPOSIO_NOTION_PARENT_PAGE_ID or parent_id inside COMPOSIO_ACTION_PARAMS_JSON — new pages must live under a parent page or database you shared with the integration.`
  }
  return message.trim() || 'Composio action failed.'
}

/**
 * Composio/Notion treat a 32-char hex string without hyphens as a **title** search, which fails
 * for real IDs from URLs. Normalize to RFC UUID form, or extract ID from a pasted notion.so link.
 */
function extractNotionIdFromPath(pathname: string): string | null {
  const clean = pathname.split('?')[0].replace(/\/+$/, '')
  const segments = clean.split('-')
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i].replace(/[^0-9a-f]/gi, '')
    if (seg.length === 32 && /^[0-9a-f]{32}$/i.test(seg)) return seg.toLowerCase()
  }
  const runs = clean.match(/[0-9a-f]{32}/gi)
  if (runs?.length) return runs[runs.length - 1].toLowerCase()
  return null
}

function normalizeNotionParentId(raw: string): string {
  let s = raw.trim()
  if (!s) return ''

  if (/^https?:\/\//i.test(s) || s.includes('notion.so') || s.includes('notion.site')) {
    const href = s.startsWith('http') ? s : `https://${s.replace(/^\/+/, '')}`
    try {
      const path = new URL(href).pathname
      const extracted = extractNotionIdFromPath(path)
      if (extracted) s = extracted
    } catch {
      /* keep s */
    }
  }

  s = s.replace(/^[`'"]|[`'"]$/g, '').trim()

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return s.toLowerCase()
  }

  const plain = s.replace(/-/g, '').toLowerCase().replace(/[^0-9a-f]/g, '')
  if (plain.length === 32 && /^[0-9a-f]{32}$/.test(plain)) {
    return `${plain.slice(0, 8)}-${plain.slice(8, 12)}-${plain.slice(12, 16)}-${plain.slice(16, 20)}-${plain.slice(20, 32)}`
  }

  return raw.trim()
}

const NOTION_CHUNK = 1900

function chunkForNotionText(s: string): string[] {
  const t = s.trim().length > 0 ? s.trim() : '—'
  if (t.length <= NOTION_CHUNK) return [t]
  const parts: string[] = []
  for (let i = 0; i < t.length; i += NOTION_CHUNK) {
    parts.push(t.slice(i, i + NOTION_CHUNK))
  }
  return parts
}

function buildLacunaGapContentBlocks(body: ComposioRequest): Array<{
  content_block: { content: string; block_property: string }
}> {
  const inner: Array<{ content: string; block_property: string }> = []
  inner.push({ content: 'Lacuna gap analysis', block_property: 'heading_2' })
  inner.push({ content: 'Concept', block_property: 'heading_3' })
  for (const c of chunkForNotionText(body.concept)) {
    inner.push({ content: c, block_property: 'paragraph' })
  }
  inner.push({ content: 'What you missed', block_property: 'heading_3' })
  for (const c of chunkForNotionText(body.gap)) {
    inner.push({ content: c, block_property: 'paragraph' })
  }
  inner.push({ content: 'Follow-up question', block_property: 'heading_3' })
  for (const c of chunkForNotionText(body.question)) {
    inner.push({ content: c, block_property: 'paragraph' })
  }
  if (body.hint.trim().length > 0) {
    inner.push({ content: 'Hint', block_property: 'heading_3' })
    for (const c of chunkForNotionText(body.hint)) {
      inner.push({ content: c, block_property: 'paragraph' })
    }
  }
  const max = 95
  let blocks = inner
  if (blocks.length > max) {
    blocks = [
      ...inner.slice(0, max - 1),
      {
        content: '… (remaining sections truncated for Notion limits)',
        block_property: 'paragraph',
      },
    ]
  }
  return blocks.map((b) => ({ content_block: b }))
}

/** Composio create-page often returns only a title; body goes via NOTION_ADD_MULTIPLE_PAGE_CONTENT. */
function extractPageIdFromComposioResult(result: { data?: unknown }): string | null {
  try {
    const json = JSON.stringify(result.data ?? {})
    const notionUrl = json.match(/notion\.so\/[^"'\s]*?([0-9a-f]{32})(?:\?|"|'|\\|]|$)/i)
    if (notionUrl?.[1]) {
      return normalizeNotionParentId(notionUrl[1])
    }
    const dashed = json.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    )
    if (dashed?.length) {
      return normalizeNotionParentId(dashed[dashed.length - 1])
    }
    const raw32 = json.match(/[0-9a-f]{32}/gi)
    if (raw32?.length) {
      return normalizeNotionParentId(raw32[raw32.length - 1])
    }
  } catch {
    /* ignore */
  }
  return null
}

function mergeEnvParams(): Record<string, unknown> | null {
  const raw = process.env.COMPOSIO_ACTION_PARAMS_JSON
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }
    return { ...(parsed as Record<string, unknown>) }
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  let tenantForErrors = 'default'
  try {
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return jsonResult({ success: false, error: 'Invalid JSON body' })
    }

    const body = parseBody(raw)
    if (!body) {
      return jsonResult({
        success: false,
        error:
          'Expected JSON with string fields: sessionId, concept, gap, question, hint',
      })
    }

    const tenantEntityId = body.sessionId.trim()
    if (!tenantEntityId) {
      return jsonResult({ success: false, error: 'sessionId must be a non-empty string' })
    }
    tenantForErrors = tenantEntityId

    const apiKey = process.env.COMPOSIO_API_KEY
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return jsonResult({
        success: false,
        error: 'COMPOSIO_API_KEY is not configured on the server',
      })
    }

    const extraParams = mergeEnvParams()
    if (extraParams === null) {
      return jsonResult({
        success: false,
        error: 'COMPOSIO_ACTION_PARAMS_JSON must be a JSON object when set',
      })
    }

    const rawAction =
      process.env.COMPOSIO_GAP_SYNC_ACTION?.trim() || 'NOTION_CREATE_NOTION_PAGE'
    // Legacy slug removed from Composio v2 actions API (returns "API not found").
    const actionName =
      rawAction === 'NOTION_CREATE_A_PAGE' ? 'NOTION_CREATE_NOTION_PAGE' : rawAction

    const markdown = [
      `## Concept`,
      body.concept,
      ``,
      `## Gap`,
      body.gap,
      ``,
      `## Follow-up question`,
      body.question,
      ``,
      `## Hint`,
      body.hint,
    ].join('\n')

    const nlaText = [
      'Create or update a Notion page that records this Lacuna gap analysis.',
      `Use "${body.concept}" as the page title (or main heading).`,
      'Organize the body with clear sections for: the gap, the follow-up question, and the hint.',
      'Keep wording faithful to the user content below.',
      '',
      markdown,
    ].join('\n')

    // Prefer explicit params for NOTION_CREATE_NOTION_PAGE; NLA is opt-in (COMPOSIO_USE_NLA=1).
    const useNla = process.env.COMPOSIO_USE_NLA === '1'

    const parentFromEnv = process.env.COMPOSIO_NOTION_PARENT_PAGE_ID?.trim()
    const clientParent = body.notionParentId?.trim()
    const actionParams: Record<string, unknown> = {
      ...extraParams,
      title: body.concept,
      markdown,
    }
    // These conflict with `markdown` on create; empty `content`/`children` from env can wipe body.
    delete actionParams.children
    delete actionParams.content
    if (clientParent) {
      actionParams.parent_id = normalizeNotionParentId(clientParent)
    } else if (
      parentFromEnv &&
      actionParams.parent_id == null &&
      actionParams.parent_page_id == null
    ) {
      actionParams.parent_id = normalizeNotionParentId(parentFromEnv)
    }

    if (typeof actionParams.parent_id === 'string' && actionParams.parent_id.length > 0) {
      actionParams.parent_id = normalizeNotionParentId(actionParams.parent_id)
    }

    if (actionName === 'NOTION_CREATE_NOTION_PAGE') {
      const hasParent =
        typeof actionParams.parent_id === 'string' &&
        actionParams.parent_id.trim().length > 0
      if (!hasParent) {
        return jsonResult({
          success: false,
          error:
            'Missing Notion parent: paste your page or database ID from its Notion URL into the “Parent in Notion” field in the app (saved in this browser), then save again. Or set COMPOSIO_NOTION_PARENT_PAGE_ID / parent_id in COMPOSIO_ACTION_PARAMS_JSON on the server. Share that parent with the integration in Notion.',
        })
      }
    }

    const toolset = new ComposioToolSet({
      apiKey: apiKey.trim(),
      entityId: tenantEntityId,
    })

    const entity = await toolset.client.getEntity(tenantEntityId)

    let connection: { status: string } | null = null
    try {
      connection = await entity.getConnection({ appName: 'notion' })
    } catch {
      connection = null
    }

    const notionReady = connection !== null && connection.status === 'ACTIVE'

    if (!notionReady) {
      const callbackUrl =
        req.headers.get('referer')?.trim() || 'http://localhost:3000'
      const link = await requestHostedNotionLink({
        apiKey: apiKey.trim(),
        userId: tenantEntityId,
        callbackUrl,
      })
      if (!link.ok) {
        return jsonResult({ success: false, error: link.error })
      }
      return jsonResult({
        success: false,
        requiresAuth: true,
        authUrl: link.redirectUrl,
      })
    }

    // Per-user execution: entityId must be this user's session id. Do not pass a global
    // connectedAccountId — that would send every user's save to one Notion account.
    const useDefaultTwoStep =
      actionName === 'NOTION_CREATE_NOTION_PAGE' && !useNla

    if (useDefaultTwoStep) {
      const parentId = String(actionParams.parent_id ?? '').trim()
      const createParams: Record<string, unknown> = {
        parent_id: parentId,
        title: body.concept,
      }
      if (typeof extraParams.icon === 'string') createParams.icon = extraParams.icon
      if (typeof extraParams.cover === 'string') createParams.cover = extraParams.cover

      const createRes = await toolset.executeAction({
        action: 'NOTION_CREATE_NOTION_PAGE',
        actionName: 'NOTION_CREATE_NOTION_PAGE',
        entityId: tenantEntityId,
        params: createParams,
      })

      if (createRes.successful === false || createRes.error) {
        const rawErr = createRes.error || 'Notion create page failed'
        return jsonResult({
          success: false,
          error: clarifyComposioError(rawErr, tenantEntityId),
        })
      }

      const pageId = extractPageIdFromComposioResult(createRes)
      if (!pageId) {
        return jsonResult({
          success: false,
          error:
            'Notion reported success but the app could not read the new page id from Composio. Open Composio logs or try saving again; if it persists, contact support with your Composio project id.',
        })
      }

      const addRes = await toolset.executeAction({
        action: 'NOTION_ADD_MULTIPLE_PAGE_CONTENT',
        actionName: 'NOTION_ADD_MULTIPLE_PAGE_CONTENT',
        entityId: tenantEntityId,
        params: {
          parent_block_id: pageId,
          content_blocks: buildLacunaGapContentBlocks(body),
        },
      })

      if (addRes.successful === false || addRes.error) {
        return jsonResult({
          success: false,
          error: `A Notion page titled “${body.concept}” was created, but adding the gap text failed: ${addRes.error ?? 'unknown error'}. Open that page and paste from the app, or try again.`,
        })
      }

      return jsonResult({ success: true })
    }

    const result = await toolset.executeAction({
      action: actionName,
      actionName,
      entityId: tenantEntityId,
      params: actionParams,
      ...(useNla ? { nlaText } : {}),
    })

    if (result.successful === false || result.error) {
      const rawErr = result.error || 'Composio action reported failure'
      return jsonResult({
        success: false,
        error: clarifyComposioError(rawErr, tenantEntityId),
      })
    }

    return jsonResult({ success: true })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Composio sync failed'
    return jsonResult({
      success: false,
      error: clarifyComposioError(message, tenantForErrors),
    })
  }
}
