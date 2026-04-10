# Menú de Prompts (Negocio) - finanzas-socios-app

Prompts en lenguaje simple para análisis funcional, validación y operación diaria.

## 1) Validar números y reportes

- `Compara Resumen vs detalle de gastos para este período [fecha inicio - fecha fin] y dime diferencias.`
- `Revisa si los totales por sucursal cuadran entre ventas y resumen mensual.`
- `Muéstrame qué familias/categorías explican la mayor parte del gasto este mes.`
- `Detecta movimientos atípicos (montos altos o inusuales) en el período [mes/año].`

## 2) Exclusiones y traspasos

- `Revisa si las familias excluidas están bien definidas para no distorsionar el resultado del negocio.`
- `Muéstrame qué movimientos hoy están excluidos y por qué familia entraron ahí.`
- `Sugiere familias que parecen traspasos internos y podrían excluirse del resumen.`
- `Valida que excluir esta familia [nombre] no oculte gastos reales del negocio.`

## 3) Socios (Mario, Mena, Victor)

- `Resume cuánto gastó cada socio en [mes/año] y cuáles fueron sus categorías principales.`
- `Compara gastos de socios entre [mes 1] y [mes 2] y explica variaciones.`
- `Lista movimientos de socios sin categoría clara para corregir clasificación.`
- `Dime si hay movimientos de socios que parecen estar mal asignados de familia.`

## 4) Control de calidad de datos

- `Busca movimientos sin categoría/familia y su impacto en el resumen.`
- `Encuentra posibles duplicados en gastos/ventas para este rango de fechas.`
- `Detecta descripciones ambiguas que deberíamos normalizar para mejores reportes.`
- `Propón una lista de mejoras para dejar datos listos para cierre mensual.`

## 5) Cierre mensual

- `Prepárame checklist de cierre del mes [mes/año] con validaciones clave.`
- `Resume hallazgos del mes: ingresos, gastos, socios, excluidos y alertas.`
- `Dime qué revisar antes de compartir el reporte final con el equipo.`
- `Genera un resumen ejecutivo de 1 página para dueños/administración.`

## 6) Decisiones de negocio

- `Si quitamos del análisis la familia [nombre], cómo cambia el resultado mensual.`
- `Qué 3 acciones concretas recomiendas para reducir gasto el próximo mes.`
- `Identifica las sucursales con mejor y peor desempeño este período.`
- `Dime dónde estamos perdiendo margen según los datos actuales.`

## 7) Mensajes y comunicación interna

- `Escribe un mensaje breve para el equipo explicando las principales variaciones del mes.`
- `Redacta observaciones para contabilidad sobre movimientos dudosos.`
- `Prepara un resumen para socios con foco en decisiones y no en detalle técnico.`
- `Transforma este análisis técnico en una versión entendible para gerencia.`

---

## Plantillas rápidas (copiar y completar)

- `Analiza [vista/reporte] para [mes/año] y destaca: 1) total, 2) variación, 3) riesgo, 4) acción sugerida.`
- `Revisa [familia/categoría] en [rango] y dime si corresponde excluirla o no, con argumento.`
- `Compara [sucursal A] vs [sucursal B] en [rango] y concluye en 5 bullets.`
- `Dame un semáforo (verde/amarillo/rojo) del mes [mes/año] con justificación breve.`

