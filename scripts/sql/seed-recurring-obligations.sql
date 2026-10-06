-- Obligaciones recurrentes iniciales (Mi negocio / RG)
-- Ejecutar una sola vez. Ajusta montos y días según evolucione el negocio.

insert into public.recurring_obligations (
  organization_id, name, day_of_month, amount_estimate, family_id, match_text, notes,
  reminder_days_before, active, sort_order
) values
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Arriendo Ricogelatto',
    3, 4055857,
    '6f70bc51-6fb9-4d0c-a31f-ae2fe1f6e567',
    'ricogelatto', 'Rodolfo Vallejos',
    5, true, 10
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Arriendo Condell 2417',
    15, 2833689,
    '6f70bc51-6fb9-4d0c-a31f-ae2fe1f6e567',
    'condell', 'Comercial e inmobiliaria S y P',
    5, true, 20
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Arriendo Uribe',
    3, 1000000,
    '6f70bc51-6fb9-4d0c-a31f-ae2fe1f6e567',
    'uribe', '',
    5, true, 30
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Arriendo Bodega',
    7, 200000,
    '6f70bc51-6fb9-4d0c-a31f-ae2fe1f6e567',
    'bodega', 'Hector Olivares',
    3, true, 40
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Arriendo Victor Carreño',
    3, 980000,
    '6f70bc51-6fb9-4d0c-a31f-ae2fe1f6e567',
    'victor carreno', '',
    5, true, 50
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Arriendo Mario Carreño',
    3, 950000,
    '6f70bc51-6fb9-4d0c-a31f-ae2fe1f6e567',
    'mario carreno', '',
    5, true, 60
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Arriendo Feria',
    5, 550000,
    '6f70bc51-6fb9-4d0c-a31f-ae2fe1f6e567',
    'feria', 'Leonel Carreño',
    3, true, 70
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Luz CGE',
    12, 18700,
    '7ee31807-df36-4713-b1fe-bc2f1dc5304a',
    'cge', 'Pago en línea luz',
    5, true, 80
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Agua Aguas de Antofagasta',
    12, 17140,
    '7ee31807-df36-4713-b1fe-bc2f1dc5304a',
    'aguas de antofagasta', '',
    5, true, 90
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Movistar hogar / internet',
    12, 57790,
    '7ee31807-df36-4713-b1fe-bc2f1dc5304a',
    'movistar', '',
    5, true, 100
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Entel PCS',
    27, 46970,
    '7ee31807-df36-4713-b1fe-bc2f1dc5304a',
    'entel pcs', '',
    5, true, 110
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Gas Lipigas',
    13, 59044,
    '7ee31807-df36-4713-b1fe-bc2f1dc5304a',
    'lipigas', 'Varios locales; revisar si hay más cuentas',
    5, true, 120
  ),
  (
    'fea07b74-332b-4f39-832b-dcb27582f011',
    'Impuestos SII',
    20, null,
    '6d80fab0-9d93-4c80-a395-045973bf6996',
    'sii.cl', 'Monto variable (F29 / contribuciones)',
    7, true, 130
  )
on conflict do nothing;
