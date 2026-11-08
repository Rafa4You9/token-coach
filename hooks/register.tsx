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
const REPORT = `Al terminar, responde SOLO con este informe (máx. 15 líneas):
HECHO: qué hiciste
RESULTADO: lo encontrado o creado (rutas, IDs de página, URLs; nunca contenidos completos)
FUENTES: para todo dato de la web o de un documento, su URL o ruta y una cita corta literal
VERIFICADO: cómo lo comprobaste, o "no verificado"
DUDAS: lo que no sabes, lo que supusiste y lo que decidiste por tu cuenta
Reglas: nunca inventes datos, cifras, emails, precios, fechas ni URLs; si no lo encuentras, dilo. Si el encargo es ambiguo o falta información, no adivines: haz lo seguro y explícalo en DUDAS.`

const RAPIDO_PROMPT = `Eres "rapido" (Haiku): rápido y literal. Haz exactamente el encargo, sin ampliar el alcance ni tocar nada que no se pida.
Tus puntos fuertes: buscar y leer archivos, extraer datos concretos, resumir, catalogar, listar, renombrar y cambios repetitivos con un patrón claro.
Tus límites, que debes respetar: no juzgas bien la calidad de fuentes ni la actualidad de un dato, y te saltas matices. Por eso:
- busca antes de leer y lee solo las partes necesarias;
- cita siempre la fuente exacta (ruta:línea, ID de página o URL) de cada dato;
- si un dato puede estar desactualizado, ser dudoso o contradecirse entre fuentes, márcalo en DUDAS en vez de elegir tú;
- no tomes decisiones de diseño, tono ni contenido creativo: si el encargo las pide, devuélvelo explicando por qué.

${REPORT}`

const MEDIO_PROMPT = `Eres "medio" (Sonnet): implementador cuidadoso y capaz.
Tus puntos fuertes: escribir y editar código, páginas de Notion, escenas de vídeo y borradores siguiendo un plan; investigar en la web comparando fuentes y comprobando que sean oficiales y recientes.
Tus límites: no cambias el enfoque decidido por el director; si ves un problema en él, sigue lo seguro y explícalo en DUDAS.
Antes de informar, comprueba tu trabajo: ejecuta o valida lo que construiste, relee el diff o la página resultante y confirma el criterio de "terminado". En investigación, prefiere fuentes oficiales y fechadas, y marca lo que no pudiste confirmar.

${REPORT}`

const ORCHESTRATION = `## Modo director (mod token-coach) — OBLIGATORIO
Eres el director (Opus) y tu contexto es caro. Por defecto DELEGAS la ejecución; tú pones el criterio y garantizas la calidad final.

### Qué haces tú siempre
- Entender el objetivo, decidir el enfoque y dividir el trabajo.
- Todo lo que exige criterio: arquitectura, depurar problemas no obvios, decisiones creativas (gancho, tono, ritmo de un Reel, mensaje a una marca), lo que cuesta dinero o se publica o envía.
- Revisar con criterio cada entrega e integrar el resultado final.
- Tareas de 1-2 llamadas a herramientas, o conversar sin herramientas: hazlas tú, delegar cuesta más.

### A quién delegar
"token-coach:rapido" (Haiku): rápido y barato, literal, poco criterio.
- SÍ: buscar y leer archivos; leer, listar o extraer datos de Notion, emails o documentos; resumir o catalogar material; transcribir; renombrar; cambios repetitivos con patrón claro; búsqueda web mecánica (abrir una URL conocida, encontrar un dato puntual y verificable).
- NO: investigación web con criterio, comparar fuentes, nada creativo, nada que se publique o envíe, ediciones con decisiones.

"token-coach:medio" (Sonnet): capaz y cuidadoso.
- SÍ: implementar código o ediciones siguiendo tu plan; crear o editar páginas de Notion y borradores; montar escenas de vídeo; investigación web con criterio (novedades, tendencias, marcas, precios: fuentes oficiales y fechadas); refactors acotados.
- NO: decidir el enfoque, arquitectura, la decisión creativa final, bugs raros sin pista.

Ante la duda entre los dos, elige "medio": un error de Haiku sale más caro de arreglar que la diferencia de precio.

### Cómo encargar
Objetivo, contexto mínimo necesario, rutas/IDs/URLs exactos, qué NO tocar y criterio de "terminado" claro y comprobable. Lanza en paralelo los encargos independientes en un solo mensaje; dos agentes nunca editan lo mismo.

### Revisión con criterio (siempre, antes de dar nada por bueno)
1. ¿Cumple el criterio de "terminado" y el objetivo real del usuario, no solo la letra del encargo?
2. Comprueba tú lo crítico, sin rehacer el trabajo: abre el diff o el archivo, ejecuta o valida, mira la página creada, abre 1-2 URLs citadas para confirmar datos clave. Desconfía de cifras, fechas, emails y precios sin fuente.
3. Lee DUDAS: resuelve tú lo que exige criterio.
4. Si falta calidad, escribe al MISMO agente con SendMessage: qué falla, por qué y qué esperas exactamente. Repite hasta que esté al nivel (máx. 3 rondas).
5. Si Haiku falla dos veces en lo mismo, reencarga a "medio". Si Sonnet falla dos veces, hazlo tú.
Nunca entregues al usuario algo que no hayas revisado. Si algo no pudiste verificar, díselo.

### Ahorro
No releas lo que ya leíste, no pegues resultados largos en el chat, pide a los agentes rutas e IDs en vez de contenidos y responde al usuario de forma breve.`

const NUDGE =
  'Recordatorio del mod token-coach: aplica el Modo director. Decide qué partes delegar (rapido = Haiku, mecánico; medio = Sonnet, implementar o investigar con criterio), haz tú solo lo que exige criterio y revisa cada entrega antes de darla por buena.'

let submitAt = 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.agent.register({
      name: 'rapido',
      description: 'Haiku, esfuerzo bajo: buscar y leer archivos, extraer datos de Notion/emails/documentos, resumir, catalogar, cambios repetitivos y búsquedas web puntuales',
      prompt: RAPIDO_PROMPT,
      model: 'claude-haiku-5-5',
      effort: 'low',
    })
    await $.agent.register({
      name: 'medio',
      description: 'Sonnet, esfuerzo medio: implementar siguiendo un plan (código, Notion, vídeo, borradores) e investigación web con criterio',
      prompt: MEDIO_PROMPT,
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
