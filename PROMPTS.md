# Menú de Prompts - finanzas-socios-app

Prompts listos para copiar en Cursor, organizados por objetivo.

## 1) Exploración y entendimiento

- `Explícame el flujo completo de [ruta] desde la UI hasta Supabase, incluyendo validaciones y filtros.`
- `Resume este archivo en 8-10 bullets: responsabilidades, entradas, salidas y riesgos.`
- `Muéstrame dónde se usa [símbolo/función] y qué impacto tendría cambiarlo.`
- `Compara el comportamiento entre /gastos, /ventas y /resumen para el mismo filtro de fechas.`

## 2) Debug y fixes

- `Tengo este error: [pega error]. Encuentra causa raíz, aplica fix mínimo y explica por qué fallaba.`
- `Reproduce mentalmente este bug: [descripción]. Enumera hipótesis y valida con evidencia en código.`
- `Revisa este endpoint y detecta edge-cases que puedan devolver datos incorrectos.`
- `Propón una corrección segura sin romper compatibilidad con datos históricos.`

## 3) Refactor sin romper lógica

- `Refactoriza este archivo para legibilidad (funciones pequeñas, nombres claros) sin cambiar comportamiento.`
- `Extrae helpers compartidos para evitar duplicación entre [archivo A] y [archivo B].`
- `Simplifica este componente grande en subcomponentes manteniendo la UI y estados actuales.`
- `Reduce complejidad ciclomática de esta función y conserva exactamente la salida.`

## 4) SQL, migraciones y RLS (Supabase)

- `Diseña migración para [requisito], con rollback y políticas RLS consistentes con owner/member.`
- `Audita políticas RLS vigentes y detecta brechas de permisos de lectura/escritura.`
- `Optimiza esta consulta para rangos amplios de fechas y sugiere índices concretos.`
- `Valida que la migración no rompa datos existentes y define plan de despliegue seguro.`

## 5) Datos y reglas de negocio (este proyecto)

- `Verifica coherencia de exclusión por familia en /api/resumen/pivot, /api/gastos/detalle y /api/ventas/detalle.`
- `Encuentra diferencias entre la categoría mostrada en UI y la clasificación real en base de datos.`
- `Propón cómo manejar movimientos sin concept_id para que no distorsionen reportes.`
- `Revisa socios (Mario/Mena/Victor): confirma que solo entren familias correctas y nada más.`

## 6) Testing y calidad

- `Crea tests para [caso], incluyendo happy path y edge-cases.`
- `Escribe un test plan manual para validar filtros por año/mes/rango y exclusiones.`
- `Dime qué partes críticas no tienen tests y prioriza por riesgo.`
- `Genera casos de regresión para evitar romper resumen mensual y vista de socios.`

## 7) UX y copy en español

- `Mejora textos de estado vacío y errores de red para que sean accionables.`
- `Propón mejoras UX para reducir clics en [pantalla].`
- `Evalúa esta vista para móvil y sugiere ajustes concretos de usabilidad.`
- `Haz consistentes labels, placeholders y mensajes entre vistas relacionadas.`

## 8) Entrega y operación

- `Genera checklist pre-release para este repo: build, lint, smoke tests, migraciones, permisos.`
- `Escribe changelog técnico de los cambios actuales: qué cambió, por qué, riesgos.`
- `Prepara un runbook de despliegue con pasos de verificación post-migración.`
- `Revisa archivos generados/no deseados y propone limpieza de gitignore.`

---

## Prompts express (rápidos)

- `Revisa este archivo abierto y dame 3 mejoras de alto impacto.`
- `Busca 2 bugs potenciales reales en esta pantalla y cómo reproducirlos.`
- `Optimiza este endpoint sin cambiar el contrato de respuesta.`
- `Explica esta función como si yo fuera nuevo en el proyecto.`

