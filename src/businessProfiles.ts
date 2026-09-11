export type BusinessProfileKey = 'services' | 'education' | 'commerce' | 'florist'

export type BusinessModuleKey =
  | 'billing'
  | 'receivables'
  | 'payments'
  | 'income'
  | 'rates'
  | 'education_enrollment'
  | 'students'
  | 'tuition'
  | 'late_fees'
  | 'inventory'
  | 'purchases'
  | 'suppliers'
  | 'delivery_notes'
  | 'orders'

export type BusinessProfilePreset = {
  key: BusinessProfileKey
  title: string
  shortTitle: string
  description: string
  bestFor: string
  modules: BusinessModuleKey[]
  nextPhase: string[]
}

export const BUSINESS_PROFILES: BusinessProfilePreset[] = [
  {
    key: 'services',
    title: 'Servicios, NFC y proyectos',
    shortTitle: 'Servicios / NFC',
    description: 'Para Zivi Dynamics, profesionales, consultores, técnicos y negocios que venden servicios, paquetes o productos personalizados.',
    bestFor: 'Cotizaciones, facturas, cobros, enlaces de pago, tasas BCV/USDT y seguimiento de clientes.',
    modules: ['billing', 'receivables', 'payments', 'income', 'rates'],
    nextPhase: ['Catálogo de servicios', 'Notas de entrega', 'Seguimiento por proyecto'],
  },
  {
    key: 'education',
    title: 'Centro educativo',
    shortTitle: 'Educativo',
    description: 'Para centros que necesitan planillas públicas, inscripción de estudiantes, representantes, mensualidades y control de mora.',
    bestFor: 'Formulario tipo Google Form, aprobación de inscripciones, creación de cliente y cobros recurrentes.',
    modules: ['billing', 'receivables', 'payments', 'income', 'rates', 'education_enrollment', 'students', 'tuition', 'late_fees'],
    nextPhase: ['Mensualidades', 'Mora automática', 'Estado de cuenta por estudiante'],
  },
  {
    key: 'commerce',
    title: 'Comercio general',
    shortTitle: 'Comercio',
    description: 'Para tiendas y comercios con ventas frecuentes, control de compras, proveedores, caja, cuentas por cobrar y por pagar.',
    bestFor: 'Facturación, inventario, compras, pagos a proveedores, ventas y caja diaria.',
    modules: ['billing', 'receivables', 'payments', 'income', 'rates', 'inventory', 'purchases', 'suppliers', 'delivery_notes'],
    nextPhase: ['Inventario', 'Compras', 'Cuentas por pagar'],
  },
  {
    key: 'florist',
    title: 'Floristería / pedidos',
    shortTitle: 'Floristería',
    description: 'Para floristerías que trabajan con pedidos, arreglos, entregas, abonos, proveedores y control de inventario sensible.',
    bestFor: 'Pedidos con fecha de entrega, notas de entrega, abonos, proveedores e inventario de flores/materiales.',
    modules: ['billing', 'receivables', 'payments', 'income', 'rates', 'inventory', 'purchases', 'suppliers', 'delivery_notes', 'orders'],
    nextPhase: ['Pedidos por fecha', 'Rutas de entrega', 'Inventario de flores y materiales'],
  },
]

export function modulesForProfile(profile: BusinessProfileKey) {
  return BUSINESS_PROFILES.find(item => item.key === profile)?.modules || BUSINESS_PROFILES[0].modules
}

export function labelForProfile(profile?: BusinessProfileKey) {
  return BUSINESS_PROFILES.find(item => item.key === profile)?.shortTitle || 'Sin definir'
}
