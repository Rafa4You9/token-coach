# token-coach

Mod para Claude Code que ayuda a ahorrar tokens:

- **Banda minimalista sobre el prompt:** % de contexto, tiempo restante del caché, tokens que leerá el próximo mensaje, cuándo se reinicia el límite de 5 h y avisos de `compacta` / `chat nuevo`.
- **Modo director (solo con Opus):** delega lo mecánico a `token-coach:rapido` (Haiku) y los pasos acotados a `token-coach:medio` (Sonnet, máx. unas 40 llamadas por encargo). Lo corto y lo difícil lo hace Opus. La banda muestra `director ✓`.
- **Aviso de modelo:** con Fable no hay director ni delegación. Si la tarea es rutinaria, el chat avisa de que Opus o Sonnet la hacen igual, y si es grande pregunta antes de seguir. La banda lo recuerda.
- **Tips en el chat:** una línea `💡` cuando conviene abrir una sesión nueva (tarea nueva o contexto muy lleno), compactar, o no pegar textos largos.

## Instalar

En una sesión de Claude Code en terminal:

```
/plugin install token-coach --marketplace Rafa4You9/token-coach
```

Responde `y` para añadir el marketplace y elige el alcance (usuario). Reinicia Claude Code.

Actualizar a la última versión: `/plugin marketplace update token-coach`.
