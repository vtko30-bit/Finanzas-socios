# Changelog

## 2026-04-20

- Resumen: deteccion de `Ingreso por credito (desembolso)` reforzada para datos historicos.
- Se prioriza el calculo desde `credits` (`disbursement_date` + `principal`) para evitar omisiones cuando faltan metadatos en `transactions`.
- Se mantiene compatibilidad legacy con transacciones antiguas de desembolso sin `credit_id`.
- Impacto funcional: la fila `Ingreso por credito (desembolso)` y `Resultado caja (incluye credito)` en `Resumen` ahora reflejan correctamente desembolsos historicos.
