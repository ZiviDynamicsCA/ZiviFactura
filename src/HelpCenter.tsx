import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Building2, Calculator, Cloud, FileText, GraduationCap, HelpCircle, ReceiptText, Search, Send, WalletCards, X } from 'lucide-react'
import './help.css'

type Guide = { id: string; title: string; summary: string; icon: JSX.Element; steps: string[]; tips?: string[] }

const guides: Guide[] = [
  { id:'start', title:'Primeros pasos', summary:'Cuenta, empresa activa y recorrido inicial.', icon:<HelpCircle/>, steps:[
    'Inicia sesión con Google o con correo y contraseña. Si usas correo, confirma tu dirección antes de activar la sincronización.',
    'Arriba verás el negocio activo. Todo lo que crees —clientes, documentos, cobros y módulos— queda asociado a ese negocio.',
    'Si manejas varios emprendimientos, pulsa “Agregar negocio” y cambia entre ellos desde el selector de la cabecera.',
    'En Inicio verás documentos, saldo real por cobrar y cobros registrados. Usa esos indicadores como resumen operativo.'
  ], tips:['No mezcles dos empresas dentro del mismo negocio: crea un negocio independiente para cada razón comercial o emprendimiento.'] },
  { id:'documents', title:'Crear facturas, presupuestos y proformas', summary:'Cómo elaborar y guardar un documento.', icon:<FileText/>, steps:[
    'Pulsa “Crear documento” o el botón central “Nueva”.',
    'Selecciona el tipo de documento, completa cliente, fecha, productos o servicios, cantidades y precios.',
    'Si necesitas hacer una operación mientras escribes el precio, usa la calculadora integrada al campo de precio unitario.',
    'Elige la moneda y, si corresponde, la tasa de referencia. ZiviFactura conserva la tasa usada por ese documento.',
    'Guarda como Borrador si aún no lo enviarás; usa Por cobrar cuando ya exista una deuda pendiente.',
    'Desde el documento puedes descargar PDF o crear el enlace público para compartir con el cliente.'
  ] },
  { id:'share', title:'Compartir con el cliente', summary:'Enlace, PDF, datos de pago y voucher.', icon:<Send/>, steps:[
    'Abre el documento y usa la opción de compartir por enlace.',
    'El cliente recibe una página donde puede revisar el documento, copiar los datos de pago y descargar su PDF.',
    'Después de pagar, el cliente completa monto, moneda, método, fecha y referencia, y carga el voucher o capture.',
    'El comprobante queda pendiente de revisión: recibir un voucher no significa que el cobro esté confirmado.',
    'Cuando verifiques el pago, regístralo en Cobros / Caja para afectar ingresos y saldo pendiente.'
  ], tips:['Para evitar confusiones, comparte el enlace como medio principal y deja el PDF como soporte descargable.'] },
  { id:'receivables', title:'Cuentas por cobrar y abonos', summary:'Saldo nominal, pagos parciales y deuda restante.', icon:<ReceiptText/>, steps:[
    'En Por cobrar aparecen las facturas emitidas con saldo abierto.',
    'La deuda conserva su moneda original. Si una factura es de 100 USD, seguirá siendo 100 USD aunque cambie su equivalencia en bolívares.',
    'Cada abono se registra de forma independiente y reduce el saldo de la factura.',
    'Cuando los abonos completan el total, ZiviFactura marca la factura como pagada.',
    'La valoración en bolívares puede cambiar con la tasa actual sin modificar la deuda contractual original.'
  ] },
  { id:'payments', title:'Cobros / Caja', summary:'Cómo registrar dinero realmente recibido.', icon:<WalletCards/>, steps:[
    'Entra a Cobros / Caja y selecciona la factura relacionada.',
    'Registra el monto aplicado, fecha, método, referencia y tasa usada en ese movimiento.',
    'Puedes registrar varios abonos para una misma factura.',
    'Cada movimiento alimenta Ingresos y Estadísticas; la factura no debe usarse como sustituto del movimiento de caja.',
    'Si eliminas o corriges un cobro, el saldo de la factura se recalcula.'
  ] },
  { id:'rates', title:'Tasas y calculadora', summary:'BCV, euro, USDT y cálculos rápidos.', icon:<Calculator/>, steps:[
    'Pulsa Tasas en la barra rápida para abrir la calculadora sin abandonar tu trabajo.',
    'Selecciona USD, VES, EUR o USDT y realiza operaciones aritméticas.',
    'El resultado principal muestra la conversión útil y puedes copiar el número con un toque.',
    'Dentro de una factura, el botón de calculadora junto al precio permite calcular y usar el resultado directamente como precio unitario.',
    'Actualiza las tasas cuando necesites confirmar valores recientes.'
  ] },
  { id:'education', title:'Inscripciones educativas', summary:'Planillas, respuestas y aprobación de representantes.', icon:<GraduationCap/>, steps:[
    'Abre Más → Inscripciones. El módulo se activa únicamente para el negocio que lo necesita.',
    'La primera vez puedes crear la plantilla de inscripción educativa basada en la planilla de referencia: estudiante, necesidades académicas, representante, responsable de pago, salud y autorizaciones.',
    'Edita el título, introducción y preguntas; define si cada campo es obligatorio y el tipo de respuesta.',
    'Pulsa Publicar para generar un enlace de inscripción. Compártelo por WhatsApp, correo o el canal que uses con los padres.',
    'El representante llena la planilla desde su teléfono sin crear una cuenta de ZiviFactura.',
    'En Respuestas revisa cada inscripción. Puedes marcarla en revisión, rechazarla o aprobarla.',
    'Al usar “Aprobar y crear cliente”, el responsable queda disponible en Facturación y Cobros sin volver a transcribir sus datos.'
  ], tips:['Mensualidades, vencimientos y mora se integrarán como la siguiente capa del módulo educativo, separadas de la inscripción.'] },
  { id:'sync', title:'Sincronización y respaldo', summary:'Qué está local, qué sube a Firebase y cómo evitar pérdida de datos.', icon:<Cloud/>, steps:[
    'ZiviFactura es local-first: puedes trabajar aunque pierdas conexión y los datos principales se conservan en el dispositivo.',
    'Cuando usas una cuenta, Firebase sincroniza una copia asociada a tu usuario para que puedas trabajar desde otros equipos.',
    'Espera a que el indicador de sincronización termine antes de cerrar un dispositivo después de cambios importantes.',
    'La opción de exportar respaldo genera una copia JSON que puedes guardar fuera del navegador.',
    'No borres los datos del sitio o almacenamiento del navegador si tienes cambios que todavía no han sincronizado.'
  ] },
  { id:'install', title:'Instalar ZiviFactura como app', summary:'PWA, acceso desde teléfono y diagnóstico básico.', icon:<Building2/>, steps:[
    'Abre ZiviFactura en Chrome usando la dirección oficial y espera a que termine de cargar.',
    'Usa “Instalar app” cuando Chrome la ofrezca. Una instalación PWA real abre ZiviFactura en una ventana independiente.',
    'Si Android solo muestra “Crear acceso directo”, no borres tus datos del sitio. Cierra pestañas antiguas, vuelve a abrir la página y revisa nuevamente después de actualizar.',
    'Si ya existe un acceso anterior con icono incorrecto, elimina solo ese acceso de la pantalla de inicio y vuelve a instalar; no borres el almacenamiento del sitio.'
  ] },
]

export default function HelpCenter(){
  const [open,setOpen]=useState(false)
  const [query,setQuery]=useState('')
  useEffect(()=>{const show=()=>setOpen(true);window.addEventListener('zivifactura:open-help',show);return()=>window.removeEventListener('zivifactura:open-help',show)},[])
  const visible=useMemo(()=>{const q=query.trim().toLowerCase();if(!q)return guides;return guides.filter(g=>[g.title,g.summary,...g.steps,...(g.tips||[])].join(' ').toLowerCase().includes(q))},[query])
  if(!open)return null
  return <div className="helpOverlay" role="dialog" aria-modal="true" aria-label="Guía de ZiviFactura"><section className="helpShell">
    <header className="helpTop"><div><span><BookOpen size={22}/></span><div><small>CENTRO DE AYUDA</small><strong>Guía y tutoriales de ZiviFactura</strong><p>Aprende el flujo completo sin salir del sistema.</p></div></div><button onClick={()=>setOpen(false)} aria-label="Cerrar"><X size={21}/></button></header>
    <div className="helpHero"><div><span>MANUAL DE USO</span><h1>Encuentra qué hacer, dónde hacerlo y qué ocurre después.</h1><p>Esta guía cubre desde la creación de una cuenta hasta cobros, enlaces de pago, tasas, múltiples negocios e inscripciones educativas.</p></div><a href="/guia.html" target="_blank" rel="noreferrer"><BookOpen size={17}/>Abrir guía completa</a></div>
    <label className="helpSearch"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar: cobros, abonos, inscripción, tasas…"/></label>
    <div className="helpGrid">{visible.map(guide=><details key={guide.id} className="helpCard"><summary><span>{guide.icon}</span><div><strong>{guide.title}</strong><small>{guide.summary}</small></div></summary><div className="helpSteps">{guide.steps.map((step,index)=><div key={index}><b>{index+1}</b><p>{step}</p></div>)}{guide.tips?.map((tip,index)=><aside key={`tip-${index}`}><strong>Consejo</strong><p>{tip}</p></aside>)}</div></details>)}</div>
    {!visible.length&&<div className="helpEmpty">No encontramos un tutorial con esa búsqueda.</div>}
  </section></div>
}
