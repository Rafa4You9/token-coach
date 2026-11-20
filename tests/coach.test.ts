import { expect, mock, test } from 'claude-code/testing'

const OPUS = 'claude-opus-5-5'

const asModel = (on: any, model: string) => {
  on('session.model', () => ({ value: model }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 20000, window: 200000, percent: 10 }, rateLimits: [] } }))
  on('clock.now', () => ({ value: Date.parse('2026-11-20T12:00:00Z') }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('tool.call', (_: any, e: any) => ({ result: { ok: true, tool: e.tool } }))
}

test('Opus reading 8 times without delegating gets a mid-turn nudge', async ($, on) => {
  asModel(on, OPUS)
  await $.turn.start({ text: 'lee todo', turnId: 't1' } as any)
  const ctx: (readonly string[] | undefined)[] = []
  for (let i = 0; i < 8; i++) {
    const r: any = await $.tool.call({ tool: 'Read', file_path: `/tmp/f${i}.md` } as any)
    ctx.push(r.context)
  }
  expect(ctx.slice(0, 7).every(c => !c || c.length === 0)).toBe(true)
  expect(String(ctx[7]?.[0] ?? '')).toContain('token-coach:rapido')
})

test('the same tool 5 times gets the repetitive nudge', async ($, on) => {
  asModel(on, OPUS)
  await $.turn.start({ text: 'actualiza', turnId: 't1' } as any)
  let last: any
  for (let i = 0; i < 5; i++) last = await $.tool.call({ tool: 'mcp__notion__notion-update-page', page_id: `${i}` } as any)
  expect(String(last.context?.[0] ?? '')).toContain('repetitivo')
})

test('a delegation silences the nudge', async ($, on) => {
  asModel(on, OPUS)
  await $.turn.start({ text: 'lee todo', turnId: 't1' } as any)
  await $.tool.call({ tool: 'Agent', subagent_type: 'token-coach:rapido', prompt: 'x', description: 'x' } as any)
  let last: any
  for (let i = 0; i < 9; i++) last = await $.tool.call({ tool: 'Read', file_path: `/tmp/f${i}.md` } as any)
  expect(last.context ?? []).toEqual([])
})

test('a big Opus turn with no delegation leaves a visible tip', async ($, on) => {
  asModel(on, OPUS)
  const rows = mock.session(on)
  mock.store(on)
  await $.turn.start({ text: 'lee todo', turnId: 't1' } as any)
  for (let i = 0; i < 10; i++) await $.tool.call({ tool: 'Bash', command: `cat /tmp/f${i}` } as any)
  await $.turn.complete({
    answer: 'hecho',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 0, model: OPUS },
  } as any)
  const all = JSON.stringify(rows.appended())
  expect(all).toContain('token-coach')
  expect(all).toContain('0 delegadas')
})

test('a subagent reading does not count against the director', async ($, on) => {
  asModel(on, OPUS)
  await $.turn.start({ text: 'x', turnId: 't1' } as any)
  let last: any
  for (let i = 0; i < 9; i++) last = await $.tool.call({ tool: 'Read', file_path: `/tmp/f${i}.md`, agentId: 'a1' } as any)
  expect(last.context ?? []).toEqual([])
})

test('the band draws on terminal and desktop', async ($, on) => {
  asModel(on, OPUS)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await ($.ui as any).mount({ plugin: 'token-coach', surface, component: 'AbovePrompt', props: { hasSurvey: false } })
    expect(JSON.stringify(await ui.find({ type: 'Text', text: /contexto/ }))).toContain('contexto')
    await ui.unmount()
  }
})
