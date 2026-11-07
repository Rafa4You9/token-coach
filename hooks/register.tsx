import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, Usage } from '../types'

const PANE = 'agentes'

const lastDoneAt = atom({ plugin: 'token-coach', key: 'lastDoneAt' } as const, 0)
const cachedTokens = atom({ plugin: 'token-coach', key: 'cachedTokens' } as const, 0)
const turns = atom({ plugin: 'token-coach', key: 'turns' } as const, 0)
const ttlMin = atom({ plugin: 'token-coach', key: 'ttlMin' } as const, 60)
const isHidden = atom({ plugin: 'token-coach', key: 'isHidden' } as const, false)

// ---- Paleta suave (pastel, contraste cómodo) --------------------------------
const C = {
  mint: '#7EE0B5',
  sky: '#7CC7FF',
  lav: '#B8A1FF',
  peach: '#FFB38A',
  pink: '#FF8FB8',
  sun: '#FFD97A',
  mute: '#8C8AA3',
}

// ---- Precios ESTIMADOS en USD por millón de tokens. Edítalos si cambian. ----
// in = entrada sin caché, write = escribir caché (x1.25), read = leer caché (x0.1)
type Tier = { name: string; in: number; write: number; read: number; rank: number }
const TIERS: Record<string, Tier> = {
  haiku: { name: 'Haiku', in: 1, write: 1.25, read: 0.1, rank: 0 },
  sonnet: { name: 'Sonnet', in: 3, write: 3.75, read: 0.3, rank: 1 },
  opus: { name: 'Opus', in: 5, write: 6.25, read: 0.5, rank: 2 },
  fable: { name: 'Fable', in: 15, write: 18.75, read: 1.5, rank: 3 },
}
const MIN = 60 * 1000

const tierOf = (model: string): Tier => {
  const m = model.toLowerCase()
  for (const k of Object.keys(TIERS)) if (m.includes(k)) return TIERS[k]
  return TIERS.sonnet
}

const usd = (n: number) => (n < 0.01 ? '<$0.01' : `$${n.toFixed(n < 1 ? 2 : 1)}`)
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${n}`)
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const untilText = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
const bar = (pct: number, width = 14) => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '█'.repeat(full) + '░'.repeat(width - full)
}
const heat = (pct: number) => (pct < 50 ? C.mint : pct < 75 ? C.sun : pct < 90 ? C.peach : C.pink)

const STATUS: Record<string, { dot: string; color: string; label: string }> = {
  pending: { dot: '◌', color: C.mute, label: 'en cola' },
  running: { dot: '●', color: C.mint, label: 'trabajando' },
  waiting: { dot: '◐', color: C.sun, label: 'esperando' },
  idle: { dot: '◑', color: C.sky, label: 'en pausa' },
  completed: { dot: '✓', color: C.lav, label: 'listo' },
  failed: { dot: '✗', color: C.pink, label: 'falló' },
  killed: { dot: '■', color: C.peach, label: 'detenido' },
}

// ---- Equipo: Opus dirige, Sonnet y Haiku ejecutan --------------------------
const REPORT = `Al terminar, responde SOLO con este informe breve:
HECHO: qué hiciste (1-3 líneas)
ARCHIVOS: rutas creadas o cambiadas
VERIFICADO: cómo lo comprobaste (o "no verificado")
DUDAS: lo que no estás seguro o decidiste por tu cuenta
No pegues contenidos largos de archivos; da rutas y líneas.`

const ORCHESTRATION = `## Modo director (mod token-coach)
Eres el director. Haz tú solo lo difícil: entender el objetivo, decidir el enfoque, diseñar, depurar problemas no obvios, revisar e integrar.
Delega con la herramienta Agent cuando una parte lleve varios pasos o muchas lecturas:
- subagent_type "token-coach:rapido" (Haiku): buscar/catalogar archivos, leer y resumir, transcribir, renombrar, cambios mecánicos y repetitivos.
- subagent_type "token-coach:medio" (Sonnet): implementar una parte concreta ya decidida, ediciones de código o de vídeo con instrucciones claras.
No delegues lo que harías en 1-2 llamadas: delegar tiene un coste de arranque.
Cada encargo lleva: objetivo, rutas exactas, qué NO tocar, criterio de "terminado". Lanza en paralelo los encargos independientes; dos agentes nunca editan el mismo archivo.
Revisión: lee el informe y comprueba lo importante tú mismo (diff, ejecución, archivo de salida) sin releerlo todo. Si falta calidad, vuelve a escribir al mismo agente con SendMessage diciendo exactamente qué mejorar; máximo 2 rondas, luego corrígelo tú.
Al final compila todo y entrega una sola respuesta al usuario.`

const seen = new Map<string, number>()
let submitAt = 0
let paneOpen = false
let idleTicks = 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agentes',
      description: 'Abre el panel de agentes con colores',
    })
    await $.agent.register({
      name: 'rapido',
      description: 'Haiku, esfuerzo bajo: búsquedas, lecturas, resúmenes, catalogar y cambios mecánicos',
      prompt: `Eres un ayudante rápido y preciso. Haz exactamente el encargo, sin ampliar el alcance ni tocar lo que no se pide.

${REPORT}`,
      model: 'claude-haiku-5-5',
      effort: 'low',
    })
    await $.agent.register({
      name: 'medio',
      description: 'Sonnet, esfuerzo medio: implementar partes concretas ya decididas',
      prompt: `Eres un implementador cuidadoso. Sigue el enfoque que te dan; si ves un problema en él, dilo en DUDAS en vez de cambiarlo por tu cuenta. Comprueba tu trabajo antes de informar.

${REPORT}`,
      model: 'claude-sonnet-5-5',
      effort: 'medium',
    })
    // El panel se abre solo mientras algún agente trabaja y se cierra
    // unos segundos después de que todos terminen.
    $.clock.every(2000, async () => {
      $.ui.invalidate('ui.render')
      const list = await $.agent.list()
      const isBusy = list.some(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
      if (isBusy) {
        idleTicks = 0
        if (!paneOpen) {
          paneOpen = true
          await $.ui.open({ id: PANE, title: 'Agentes ✦' })
        }
      } else if (paneOpen && ++idleTicks >= 3) {
        paneOpen = false
        await $.ui.close({ id: PANE })
      }
    })
    return next(e)
  })

  on('command.run', { command: 'agentes' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agentes ✦' })
    return { text: 'Panel de agentes abierto.' }
  })

  // Solo el chat principal (tiene la herramienta Agent) y solo en Opus/Fable.
  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    const isLead = /opus|fable/i.test(e.model) && e.tools.includes('Agent')
    if (!isLead) return res
    return {
      sections: [...res.sections, { id: 'token-coach:director', text: ORCHESTRATION, scope: 'session' as const }],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    submitAt = await $.clock.now()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const t = await $.clock.now()
      // Aprende la duración real del caché: tras una pausa de más de 5 min,
      // si el modelo aún leyó del caché, este dura 1 h; si no, 5 min.
      const prev = await read($, lastDoneAt)
      const gap = submitAt - prev
      if (prev > 0 && submitAt > 0 && gap > 5 * MIN && gap < 60 * MIN && e.usage) {
        const hit = e.usage.cache_read_input_tokens > 2000
        await update($, ttlMin, () => (hit ? 60 : 5))
      }
      await update($, lastDoneAt, () => t)
      await update($, turns, n => n + 1)
      if (e.usage) {
        const cached = e.usage.cache_read_input_tokens + e.usage.cache_creation_input_tokens
        if (cached > 0) await update($, cachedTokens, () => cached)
      }
    }
    return next(e)
  })

  // ---- Banda encima del prompt: una sola fila limpia ------------------------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const raw = await $.session.usage()
    const model = await $.session.model()
    const five = raw.rateLimits?.find((r: any) => r.kind === 'five_hour')
    const percent = raw.context?.percent ?? 0
    const tokens = raw.context?.tokens ?? 0
    const t = await $.clock.now()

    const { Box, Text } = $.ui.resolve(e)
    const done = await read($, lastDoneAt)
    const cached = await read($, cachedTokens)
    const n = await read($, turns)

    const cur = tierOf(model)
    const ctx = tokens
    const ttl = await read($, ttlMin)
    const left = ttl * MIN - (t - done)
    const isWarm = done > 0 && left > 0
    const sendCost = (ctx / 1e6) * (isWarm || !done ? cur.read : cur.write)

    let tip: { icon: string; word: string; color: string } | null = null
    if (percent >= 85 || (percent >= 70 && n > 40)) tip = { icon: '🆕', word: 'chat nuevo', color: C.pink }
    else if (percent >= 65) tip = { icon: '🧹', word: 'compacta', color: C.peach }
    else if (done > 0 && !isWarm && ctx > 60000) tip = { icon: '🧊', word: 'compacta antes', color: C.sky }


    return (
      <Box flexDirection="row" paddingX={1} gap={2}>
        <Text color={heat(percent)}>contexto {Math.round(percent)}%</Text>
        <Text color={isWarm || !done ? C.mint : C.sky}>
          {isWarm ? `caché ● ${mmss(left)}` : done ? 'caché ❄ frío' : 'caché ○'}
        </Text>
        <Text color={C.mute}>envía ~{k(ctx)} tok</Text>
        {five?.resetsAt && (
          <Text color={C.sky}>reinicio en {untilText(Date.parse(five.resetsAt) - t)}</Text>
        )}
        {tip && <Text color={tip.color}>{tip.word}</Text>}
      </Box>
    )
  })

  // ---- Panel de agentes ------------------------------------------------------
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await $.clock.now()
    const found: any[] = await $.agent.list()
    const list: AgentRow[] = found.map((a: any) => {
      if (!seen.has(a.id)) seen.set(a.id, t)
      return {
        id: a.id,
        label: a.name ?? a.description ?? a.type,
        type: a.type,
        status: a.status,
        parentId: a.parentId,
        since: seen.get(a.id) ?? t,
      }
    })
    const raw = await $.session.usage()
    const percent = raw.context?.percent ?? 0
    const cost = raw.cost?.usd ?? 0

    const running = list.filter(a => a.status === 'running').length
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 6)
    const palette = [C.mint, C.sky, C.lav, C.peach, C.pink, C.sun]

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={C.mute}>
          {list.length === 0 ? '○ sin agentes' : `${running} activos`}
        </Text>
        {list.slice(-room).map((a, i) => {
          const s = STATUS[a.status] ?? STATUS.pending
          const accent = palette[i % palette.length]
          const live = a.status === 'running'
          return (
            <Text key={a.id} color={live ? accent : C.mute} wrap="truncate-end">
              {s.dot} {a.label} <Text color={C.mute}>{mmss(t - a.since)}</Text>
            </Text>
          )
        })}
        <Text color={heat(percent)}>
          contexto {Math.round(percent)}%
        </Text>
      </Box>
    )
  })
}
