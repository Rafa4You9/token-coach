import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const lastDoneAt = atom({ plugin: 'token-coach', key: 'lastDoneAt' } as const, 0)
const turns = atom({ plugin: 'token-coach', key: 'turns' } as const, 0)
const ttlMin = atom({ plugin: 'token-coach', key: 'ttlMin' } as const, 60)
const isDirector = atom({ plugin: 'token-coach', key: 'isDirector' } as const, false)

// ---- Paleta suave ----------------------------------------------------------
const C = {
  mint: '#7EE0B5',
  sky: '#7CC7FF',
  lav: '#B8A1FF',
  peach: '#FFB38A',
  pink: '#FF8FB8',
  sun: '#FFD97A',
  mute: '#8C8AA3',
}

const MIN = 60 * 1000
const isLeadModel = (model: string) => /opus|fable/i.test(model)

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${n}`)
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const untilText = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
const heat = (pct: number) => (pct < 50 ? C.mint : pct < 75 ? C.sun : pct < 90 ? C.peach : C.pink)

// ---- Equipo: Opus dirige, Sonnet y Haiku ejecutan --------------------------
const REPORT = `Al terminar, responde SOLO con este informe breve (máx. 12 líneas):
HECHO: qué hiciste
ARCHIVOS: rutas o páginas creadas/cambiadas
VERIFICADO: cómo lo comprobaste (o "no verificado")
DUDAS: lo que no estás seguro o decidiste por tu cuenta
Nunca pegues contenidos completos; da rutas, IDs y líneas.`

const ORCHESTRATION = `## Modo director (mod token-coach) — OBLIGATORIO
Eres el director y tu contexto es caro. Por defecto DELEGA; trabajar tú directamente es la excepción.

Haz tú directamente SOLO:
- conversar, responder preguntas o explicar sin herramientas;
- una tarea que se resuelve en 1-2 llamadas a herramientas;
- decidir el enfoque, revisar lo que entregan los agentes y redactar la respuesta final.

DELEGA SIEMPRE (herramienta Agent):
- leer o buscar en más de 2 archivos, páginas de Notion, emails o webs → subagent_type "token-coach:rapido" (Haiku);
- catalogar, resumir, transcribir, extraer datos, renombrar, cambios repetitivos → "token-coach:rapido";
- crear o editar contenido siguiendo un plan ya decidido (código, páginas de Notion, edición de vídeo, borradores) → "token-coach:medio" (Sonnet);
- cualquier parte de 3 o más pasos que no exija tu criterio.

Cómo encargar: objetivo, rutas/IDs exactos, qué NO tocar y criterio de "terminado", en pocas líneas. Lanza en paralelo los encargos independientes en un solo mensaje; dos agentes nunca editan lo mismo.
Revisión: confía en el informe y comprueba solo lo crítico (un diff, un archivo, una página), sin releerlo todo. Si falta calidad, escribe al mismo agente con SendMessage qué mejorar (máx. 2 rondas) y luego corrígelo tú.
Ahorro: no releas archivos que ya leíste, no pegues resultados largos en el chat y responde al usuario de forma breve.`

const NUDGE =
  'Recordatorio del mod token-coach: aplica el Modo director. Antes de usar herramientas, decide qué partes delegar a token-coach:rapido / token-coach:medio; haz tú solo lo que requiera tu criterio.'

let submitAt = 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.agent.register({
      name: 'rapido',
      description: 'Haiku, esfuerzo bajo: búsquedas, lecturas, resúmenes, catalogar, extraer datos y cambios mecánicos (archivos, Notion, emails, web)',
      prompt: `Eres un ayudante rápido y preciso. Haz exactamente el encargo, sin ampliar el alcance ni tocar lo que no se pide. Usa las herramientas de forma eficiente: busca antes de leer, lee solo las partes necesarias.

${REPORT}`,
      model: 'claude-haiku-5-5',
      effort: 'low',
    })
    await $.agent.register({
      name: 'medio',
      description: 'Sonnet, esfuerzo medio: implementar o crear contenido siguiendo un plan ya decidido (código, Notion, vídeo, borradores)',
      prompt: `Eres un implementador cuidadoso. Sigue el enfoque que te dan; si ves un problema en él, dilo en DUDAS en vez de cambiarlo por tu cuenta. Comprueba tu trabajo antes de informar.

${REPORT}`,
      model: 'claude-sonnet-5-5',
      effort: 'medium',
    })
    // Redibuja la banda para que el contador del caché avance.
    $.clock.every(5000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  // Regla fija en el system prompt del chat principal (Opus/Fable con Agent).
  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    const isLead = (isLeadModel(e.model) || isLeadModel(e.promptModel)) && e.tools.includes('Agent')
    if (!isLead) return res
    await update($, isDirector, () => true)
    return {
      sections: [...res.sections, { id: 'token-coach:director', text: ORCHESTRATION, scope: 'session' as const }],
    }
  })

  // Recordatorio corto e invisible en cada prompt: es lo que hace que delegue sin pedírselo.
  on('prompt.submit', async ($, e, next) => {
    submitAt = await $.clock.now()
    if (e.command || e.isMeta) return next(e)
    const model = await $.session.model()
    if (!isLeadModel(model)) return next(e)
    return next({ ...e, context: [...(e.context ?? []), NUDGE] })
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
    }
    return next(e)
  })

  // ---- Banda encima del prompt: una sola fila --------------------------------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const raw = await $.session.usage()
    const model = await $.session.model()
    const five = raw.rateLimits?.find((r: any) => r.kind === 'five_hour')
    const percent = raw.context?.percent ?? 0
    const tokens = raw.context?.tokens ?? 0
    const t = await $.clock.now()

    const { Box, Text } = $.ui.resolve(e)
    const done = await read($, lastDoneAt)
    const n = await read($, turns)
    const ttl = await read($, ttlMin)
    const director = (await read($, isDirector)) && isLeadModel(model)

    const left = ttl * MIN - (t - done)
    const isWarm = done > 0 && left > 0

    let tip: { word: string; color: string } | null = null
    if (percent >= 85 || (percent >= 70 && n > 40)) tip = { word: 'chat nuevo', color: C.pink }
    else if (percent >= 65) tip = { word: 'compacta', color: C.peach }
    else if (done > 0 && !isWarm && tokens > 60000) tip = { word: 'compacta antes', color: C.sky }

    return (
      <Box flexDirection="row" paddingX={1} gap={2}>
        <Text color={heat(percent)}>contexto {Math.round(percent)}%</Text>
        <Text color={isWarm || !done ? C.mint : C.sky}>
          {isWarm ? `caché ● ${mmss(left)}` : done ? 'caché ❄ frío' : 'caché ○'}
        </Text>
        <Text color={C.mute}>envía ~{k(tokens)} tok</Text>
        {five?.resetsAt && (
          <Text color={C.sky}>reinicio en {untilText(Date.parse(five.resetsAt) - t)}</Text>
        )}
        {director && <Text color={C.lav}>director ✓</Text>}
        {tip && <Text color={tip.color}>{tip.word}</Text>}
      </Box>
    )
  })
}
