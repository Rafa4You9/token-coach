# token-coach

Mod para Claude Code que ayuda a ahorrar tokens:

- **Banda minimalista sobre el prompt:** % de contexto, tiempo restante del caché, tokens que leerá el próximo mensaje, cuándo se reinicia el límite de 5 h, **% del gasto que hicieron Haiku y Sonnet** (`delegado N%`: verde ≥20%, rosa <5%) y avisos de `compacta` / `chat nuevo`.
- **Mide de verdad (v0.6):** cuenta cada llamada del chat principal, cuáles son de leer o buscar, cuántas veces se repite la misma herramienta y cuántos encargos van a subagentes, y reparte el gasto por modelo.
- **Avisos a mitad de turno al modelo:** si Opus (o Sonnet) lleva 8 llamadas de leer/buscar sin delegar, o repite 5 veces la misma operación (p. ej. `notion-update-page`), el mod se lo dice pegado al resultado de la herramienta para que pase el resto a `rapido` (Haiku) con la lista y el patrón.
- **Tips 💡 en el chat que no gastan tokens:** al terminar el turno el mod deja un aviso visible (el modelo no lo lee): turno grande sin delegar, trabajo repetitivo, sesión rutinaria que iría igual en Sonnet, contexto lleno, caché frío, texto largo pegado, casi todo el gasto en Opus, contexto fijo grande al arrancar y un resumen de los últimos 14 días una vez al día. Cada tipo descansa unos turnos para no repetirse.
- **Modo director (Opus):** delega lo mecánico y lo repetitivo (la misma operación 5+ veces) a `token-coach:rapido` (Haiku) y los pasos acotados a `token-coach:medio` (Sonnet, máx. unas 40 llamadas por encargo). Lo corto y lo difícil lo hace Opus.
- **Modo ahorro (Sonnet):** Sonnet trabaja, pero lo repetitivo y largo lo pasa a Haiku.
- **Aviso de modelo:** con Fable no hay director ni delegación. Si la tarea es rutinaria, el chat avisa de que Opus o Sonnet la hacen igual, y si es grande pregunta antes de seguir. La banda lo recuerda.

## Instalar

En una sesión de Claude Code en terminal:

```
/plugin install token-coach --marketplace Rafa4You9/token-coach
```

Responde `y` para añadir el marketplace y elige el alcance (usuario). Reinicia Claude Code.

Actualizar a la última versión: `/plugin marketplace update token-coach`.
