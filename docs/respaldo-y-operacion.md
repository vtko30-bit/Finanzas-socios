# Respaldo y operación mensual

## Política de respaldo
- Base de datos: backup diario automático en Supabase.
- Archivos: respaldar buckets `imports` y `exports`.
- Retención mínima sugerida: 30 días.

## Checklist operativo semanal
- Revisar lotes fallidos en `import_batches`.
- Verificar filas inválidas en `import_rows`.
- Revisar eventos recientes en `audit_log`.
- Confirmar exportaciones críticas en `report_exports`.

## Checklist mensual
- Probar restauración en entorno de pruebas.
- Validar acceso de usuarios activos en `organization_members`.
- Revisar políticas RLS y permisos de service role.
- Descargar snapshot de evidencia operativa.

## Respuesta ante incidente
1. Congelar nuevas importaciones.
2. Identificar lote/periodo afectado.
3. Restaurar backup en entorno de prueba.
4. Validar integridad (conteos y montos).
5. Ejecutar recuperación en producción.
6. Registrar incidente en bitácora con causa y acciones preventivas.
