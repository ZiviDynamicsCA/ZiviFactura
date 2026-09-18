import { useEffect, useMemo, useState } from 'react'
import { BarChart3, BookOpen, Building2, CheckCircle2, ClipboardList, Cloud, CloudOff, DollarSign, Eye, EyeOff, GraduationCap, HelpCircle, LogOut, Mail, Package, Plus, ReceiptText, RefreshCw, Settings2, ShieldCheck, UserPlus, Wallet, WalletCards } from 'lucide-react'
import AdminDashboard from './AdminDashboard'
import App from './App'
import BusinessProfileView from './BusinessProfileView'
import CatalogView from './CatalogView'
import DeliveryNotesView from './DeliveryNotesView'
import PaymentsView from './PaymentsView'
import ReceivablesView from './ReceivablesView'
import { createCompany, db, defaultCompany, ensureCompany } from './db'
import { getActiveCompanyId, setActiveCompanyId } from './companyScope'
import { labelForProfile, modulesForProfile, type BusinessModuleKey, type BusinessProfileKey } from './businessProfiles'
import { createEmailAccount, firebaseConfigured, isPasswordAccount, observeAuth, readVerificationEmailStatus, refreshAccountVerification, requestPasswordReset, sendAccountVerification, signInWithEmail, signInWithGoogle, signOutFirebase, type FirebaseUser } from './firebase'
import { startFirebaseSync, syncFirebaseNow, type SyncState } from './firebaseSync'
import type { Company } from './types'
import './auth.css'
import './admin.css'
import './modular-workspace.css'

const LOCAL_UID_KEY = 'zivifactura.firebase.uid'
type Workspace = 'billing' | 'receivables' | 'payments' | 'income' | 'stats' | 'catalog' | 'deliveryNotes' | 'profile'
type AuthMode = 'login' | 'signup'

async function prepareLocalAccount(uid: string) {
  const previousUid = localStorage.getItem(LOCAL_UID_KEY)
  if (previousUid && previousUid !== uid) {
    await db.transaction('rw', db.company, db.clients, db.products, db.invoices, db.payments, async () => {
      await Promise.all([
        db.company.clear(),
        db.clients.clear(),
        db.products.clear(),
        db.invoices.clear(),
        db.payments.clear(),
      ])
    })
    await ensureCompany()
    setActiveCompanyId(1)
  }
  localStorage.setItem(LOCAL_UID_KEY, uid)
}

function GoogleMark() {
  return <span className="googleMark" aria-hidden="true">G</span>
}

function LegalLinks({ compact = false }: { compact?: boolean }) {
  return <nav className={compact ? 'authLegalLinks compact' : 'authLegalLinks'} aria-label="Información legal">
    <a href="/privacidad.html" target="_blank" rel="noreferrer">Privacidad</a>
    <a href="/terminos.html" target="_blank" rel="noreferrer">Términos</a>
    <a href="/cookies.html" target="_blank" rel="noreferrer">Cookies</a>
    <a href="/acerca.html" target="_blank" rel="noreferrer">Acerca de</a>
  </nav>
}

function authError(error: unknown) {
  const code = (error as { code?: string })?.code || ''
  if (code === 'auth/email-already-in-use') return 'Ese correo ya tiene una cuenta. Inicia sesión o recupera la contraseña.'
  if (code === 'auth/weak-password') return 'La contraseña debe tener al menos 6 caracteres.'
  if (code === 'auth/invalid-email') return 'Escribe un correo electrónico válido.'
  if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') return 'Correo o contraseña incorrectos.'
  if (code === 'auth/operation-not-allowed') return 'El acceso con correo y contraseña todavía no está habilitado en Firebase Authentication.'
  if (code === 'auth/too-many-requests') return 'Hubo demasiados intentos. Espera unos minutos e inténtalo nuevamente.'
  if (code === 'auth/network-request-failed') return 'No se pudo conectar. Verifica tu conexión a internet.'
  if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri') return 'Firebase rechazó la URL de retorno configurada para el correo. Ya estamos usando el flujo estándar para evitar este bloqueo.'
  if (code === 'auth/quota-exceeded') return 'Firebase alcanzó temporalmente el límite de correos de autenticación. Intenta nuevamente más tarde.'
  const message = error instanceof Error ? error.message : 'No se pudo completar la operación.'
  return message.replace('Firebase:', '').trim()
}

function LoginScreen({ onLocal }: { onLocal: () => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signup, setSignup] = useState({
    fullName: '', companyName: '', taxId: '', phone: '', email: '', password: '', confirmPassword: '',
    address: '', city: '', currency: 'USD', defaultTaxRate: '0', prefix: 'FAC',
    mobilePaymentBank: '', mobilePaymentPhone: '', mobilePaymentId: '',
    bankName: '', bankAccountType: '', bankAccountNumber: '', bankAccountHolder: '',
    binanceId: '', paymentNotes: '',
  })

  const switchMode = (next: AuthMode) => {
    setMode(next)
    setError('')
    setNotice('')
  }

  async function googleLogin() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(authError(err))
      setBusy(false)
    }
  }

  async function emailLogin(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await signInWithEmail(email, password)
    } catch (err) {
      setError(authError(err))
      setBusy(false)
    }
  }

  async function resetPassword() {
    if (!email.trim()) return setError('Escribe tu correo arriba para enviarte el enlace de recuperación.')
    setBusy(true)
    setError('')
    try {
      await requestPasswordReset(email)
      setNotice('Te enviamos un enlace para restablecer tu contraseña. Revisa también la carpeta de spam.')
    } catch (err) {
      setError(authError(err))
    } finally {
      setBusy(false)
    }
  }

  async function register(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!signup.fullName.trim() || !signup.companyName.trim() || !signup.phone.trim() || !signup.email.trim()) return setError('Completa nombre, empresa, teléfono y correo electrónico.')
    if (signup.password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.')
    if (signup.password !== signup.confirmPassword) return setError('Las contraseñas no coinciden.')
    setBusy(true)
    try {
      const credential = await createEmailAccount(signup.fullName, signup.email, signup.password)
      await prepareLocalAccount(credential.user.uid)
      await db.company.put({
        ...defaultCompany,
        id: 1,
        name: signup.companyName.trim(),
        taxId: signup.taxId.trim(),
        phone: signup.phone.trim(),
        email: signup.email.trim().toLowerCase(),
        address: signup.address.trim(),
        city: signup.city.trim(),
        currency: signup.currency,
        defaultTaxRate: Math.max(0, Number(signup.defaultTaxRate) || 0),
        prefix: signup.prefix.trim().toUpperCase().slice(0, 8) || 'FAC',
        mobilePaymentBank: signup.mobilePaymentBank.trim(),
        mobilePaymentPhone: signup.mobilePaymentPhone.trim(),
        mobilePaymentId: signup.mobilePaymentId.trim(),
        bankName: signup.bankName.trim(),
        bankAccountType: signup.bankAccountType.trim(),
        bankAccountNumber: signup.bankAccountNumber.trim(),
        bankAccountHolder: signup.bankAccountHolder.trim(),
        binanceId: signup.binanceId.trim(),
        paymentNotes: signup.paymentNotes.trim(),
      })
      setActiveCompanyId(1)
      await sendAccountVerification(credential.user)
    } catch (err) {
      setError(authError(err))
      setBusy(false)
    }
  }

  const updateSignup = (key: keyof typeof signup, value: string) => setSignup(current => ({ ...current, [key]: value }))

  return <main className="authScreen">
    <section className={`authPanel ${mode === 'signup' ? 'signupPanel' : ''}`}>
      <div className="authBrand"><span><ShieldCheck size={28}/></span><div><strong>ZiviFactura</strong><small>Zivi Dynamics C.A.</small></div></div>
      <div className="authCopy compactCopy">
        <span className="eyebrow">FACTURACIÓN Y CONTROL ADMINISTRATIVO</span>
        <h1>{mode === 'login' ? 'Entra a tu cuenta.' : 'Crea tu cuenta y empieza a facturar.'}</h1>
        <p>{mode === 'login' ? 'Tus facturas, cobros, cuentas por cobrar y estadísticas pueden acompañarte en todos tus dispositivos.' : 'Configuraremos desde el inicio los datos principales de tu empresa para que puedas comenzar sin pasos innecesarios.'}</p>
      </div>

      <div className="authTabs" role="tablist">
        <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}><Mail size={16}/>Iniciar sesión</button>
        <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}><UserPlus size={16}/>Crear cuenta</button>
      </div>

      {mode === 'login' ? <form className="authForm" onSubmit={emailLogin}>
        <label><span>Correo electrónico</span><input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="tu@correo.com" required/></label>
        <label><span>Contraseña</span><div className="passwordField"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Tu contraseña" required/><button type="button" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
        <button className="primaryAuth" disabled={busy} type="submit">{busy ? 'Ingresando…' : 'Iniciar sesión'}</button>
        <button className="forgotPassword" disabled={busy} type="button" onClick={() => void resetPassword()}>¿Olvidaste tu contraseña?</button>
      </form> : <form className="authForm signupForm" onSubmit={register}>
        <div className="signupSection"><strong>Tu cuenta</strong><small>Información del responsable de la cuenta.</small></div>
        <div className="signupGrid">
          <label><span>Nombre y apellido *</span><input value={signup.fullName} onChange={event => updateSignup('fullName', event.target.value)} autoComplete="name" required/></label>
          <label><span>Teléfono *</span><input value={signup.phone} onChange={event => updateSignup('phone', event.target.value)} inputMode="tel" autoComplete="tel" placeholder="0412..." required/></label>
          <label className="wide"><span>Correo electrónico *</span><input type="email" value={signup.email} onChange={event => updateSignup('email', event.target.value)} autoComplete="email" placeholder="tu@correo.com" required/></label>
          <label><span>Contraseña *</span><input type="password" value={signup.password} onChange={event => updateSignup('password', event.target.value)} autoComplete="new-password" minLength={6} required/></label>
          <label><span>Confirmar contraseña *</span><input type="password" value={signup.confirmPassword} onChange={event => updateSignup('confirmPassword', event.target.value)} autoComplete="new-password" minLength={6} required/></label>
        </div>

        <div className="signupSection"><strong>Datos de tu empresa</strong><small>Se guardarán directamente en Configuración y en tus próximos documentos.</small></div>
        <div className="signupGrid">
          <label><span>Empresa / razón social *</span><input value={signup.companyName} onChange={event => updateSignup('companyName', event.target.value)} required/></label>
          <label><span>RIF / RUC / identificación fiscal</span><input value={signup.taxId} onChange={event => updateSignup('taxId', event.target.value)}/></label>
          <label><span>Ciudad</span><input value={signup.city} onChange={event => updateSignup('city', event.target.value)}/></label>
          <label><span>Moneda principal</span><select value={signup.currency} onChange={event => updateSignup('currency', event.target.value)}><option>USD</option><option>EUR</option><option>VES</option><option>USDT</option><option>COP</option></select></label>
          <label className="wide"><span>Dirección</span><input value={signup.address} onChange={event => updateSignup('address', event.target.value)}/></label>
          <label><span>Impuesto predeterminado %</span><input type="number" min="0" step="0.01" value={signup.defaultTaxRate} onChange={event => updateSignup('defaultTaxRate', event.target.value)}/></label>
          <label><span>Prefijo de facturas</span><input value={signup.prefix} onChange={event => updateSignup('prefix', event.target.value.toUpperCase())} maxLength={8}/></label>
        </div>

        <details className="signupOptional">
          <summary>Agregar datos de cobro ahora <span>Opcional</span></summary>
          <div className="signupGrid optionalGrid">
            <label><span>Banco para pago móvil</span><input value={signup.mobilePaymentBank} onChange={event => updateSignup('mobilePaymentBank', event.target.value)}/></label>
            <label><span>Teléfono pago móvil</span><input value={signup.mobilePaymentPhone} onChange={event => updateSignup('mobilePaymentPhone', event.target.value)} inputMode="tel"/></label>
            <label className="wide"><span>Cédula / RIF pago móvil</span><input value={signup.mobilePaymentId} onChange={event => updateSignup('mobilePaymentId', event.target.value)}/></label>
            <label><span>Banco / cuenta</span><input value={signup.bankName} onChange={event => updateSignup('bankName', event.target.value)}/></label>
            <label><span>Tipo de cuenta</span><input value={signup.bankAccountType} onChange={event => updateSignup('bankAccountType', event.target.value)} placeholder="Corriente / Ahorro"/></label>
            <label className="wide"><span>Número de cuenta</span><input value={signup.bankAccountNumber} onChange={event => updateSignup('bankAccountNumber', event.target.value)}/></label>
            <label className="wide"><span>Titular de la cuenta</span><input value={signup.bankAccountHolder} onChange={event => updateSignup('bankAccountHolder', event.target.value)}/></label>
            <label className="wide"><span>Binance Pay ID / correo</span><input value={signup.binanceId} onChange={event => updateSignup('binanceId', event.target.value)}/></label>
            <label className="wide"><span>Otras instrucciones de pago</span><textarea rows={3} value={signup.paymentNotes} onChange={event => updateSignup('paymentNotes', event.target.value)}/></label>
          </div>
        </details>

        <button className="primaryAuth" disabled={busy} type="submit">{busy ? 'Creando cuenta…' : 'Crear mi cuenta'}</button>
        <small className="signupConsent">Al crear una cuenta aceptas los <a href="/terminos.html" target="_blank" rel="noreferrer">Términos</a> y confirmas que leíste la <a href="/privacidad.html" target="_blank" rel="noreferrer">Política de Privacidad</a>.</small>
      </form>}

      <div className="authDivider"><span>o continúa de forma segura con</span></div>
      <button className="googleButton" disabled={busy} onClick={googleLogin}><GoogleMark/>{busy ? 'Conectando…' : 'Continuar con Google'}</button>
      <div className="googleTrust"><ShieldCheck size={15}/><span>Google solo identifica tu cuenta. ZiviFactura no recibe tu contraseña ni solicita acceso a Gmail, Drive, contactos o calendario.</span></div>

      {error && <div className="authError">{error}</div>}
      {notice && <div className="authNotice">{notice}</div>}
      <button className="localFallback" onClick={onLocal}>Entrar sin cuenta · solo en este dispositivo</button>
      <small className="authLegal">Las cuentas se autentican con Firebase Authentication y los datos sincronizados se organizan por usuario en Firestore.</small>
      <LegalLinks/>
    </section>
  </main>
}

function VerifyEmailScreen({ user, onVerified, onLogout }: { user: FirebaseUser; onVerified: () => void; onLogout: () => void }) {
  const previousStatus = readVerificationEmailStatus()
  const statusForThisEmail = previousStatus?.email && previousStatus.email === (user.email || '') ? previousStatus : null
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(statusForThisEmail?.ok
    ? 'Firebase aceptó el envío del correo de verificación. Revisa Recibidos, Spam y Promociones.'
    : 'Pulsa “Reenviar correo” para solicitar un nuevo enlace de verificación.')
  const [error, setError] = useState(statusForThisEmail && !statusForThisEmail.ok
    ? authError({ code: statusForThisEmail.code, message: statusForThisEmail.message })
    : '')

  async function resend() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await sendAccountVerification(user)
      setNotice('Firebase aceptó el reenvío. Revisa Recibidos, Spam y Promociones; el remitente puede aparecer como noreply de Firebase.')
    } catch (err) {
      setError(authError(err))
    } finally {
      setBusy(false)
    }
  }

  async function check() {
    setBusy(true)
    setError('')
    try {
      const verified = await refreshAccountVerification(user)
      if (verified) onVerified()
      else setNotice('Todavía no aparece verificado. Abre el enlace del correo y vuelve a pulsar este botón.')
    } catch (err) {
      setError(authError(err))
    } finally {
      setBusy(false)
    }
  }

  return <main className="authScreen verifyScreen">
    <section className="authPanel verifyPanel">
      <div className="authBrand"><span><Mail size={28}/></span><div><strong>ZiviFactura</strong><small>Protección de tu cuenta</small></div></div>
      <div className="verifyIcon"><Mail size={32}/></div>
      <span className="eyebrow verifyEyebrow">VERIFICA TU CORREO</span>
      <h1>Confirma que este correo es tuyo.</h1>
      <p>Enviamos un enlace de verificación a <strong>{user.email}</strong>. Hasta confirmarlo no activaremos la sincronización de tus datos administrativos.</p>
      <div className="verifyActions">
        <button className="primaryAuth" disabled={busy} onClick={() => void check()}><CheckCircle2 size={18}/>{busy ? 'Comprobando…' : 'Ya verifiqué mi correo'}</button>
        <button className="verifySecondary" disabled={busy} onClick={() => void resend()}><RefreshCw size={17}/>Reenviar correo</button>
        <button className="localFallback" disabled={busy} onClick={onLogout}><LogOut size={16}/>Cambiar de cuenta</button>
      </div>
      {error && <div className="authError">{error}</div>}
      {notice && <div className="authNotice">{notice}</div>}
      <small className="authLegal">Las cuentas que ingresan con Google no necesitan repetir esta verificación.</small>
      <LegalLinks/>
    </section>
  </main>
}

function AccountBar({ user, state, message, onLogout }: { user: FirebaseUser; state: SyncState; message: string; onLogout: () => void }) {
  const icon = state === 'error' ? <CloudOff size={16}/> : state === 'synced' ? <CheckCircle2 size={16}/> : <Cloud size={16}/>
  return <div className={`accountBar ${state}`}>
    <div className="syncState">{icon}<span>{message || (state === 'syncing' ? 'Sincronizando…' : 'Firebase conectado')}</span></div>
    <div className="accountIdentity">
      {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer"/> : <span className="accountInitial">{(user.displayName || user.email || 'U')[0]}</span>}
      <span><strong>{user.displayName || 'Cuenta ZiviFactura'}</strong><small>{user.email}</small></span>
      <button title="Cerrar sesión" onClick={onLogout}><LogOut size={17}/></button>
    </div>
  </div>
}

function BusinessSwitcher({ activeId, onChange }: { activeId: number; onChange: (id: number) => void }) {
  const [companies, setCompanies] = useState<Company[]>([])

  async function load() {
    await ensureCompany()
    const rows = (await db.company.toArray()).sort((a, b) => a.id - b.id)
    setCompanies(rows)
    if (!rows.some(row => row.id === activeId)) onChange(1)
  }

  useEffect(() => {
    void load()
    const timer = window.setTimeout(() => void load(), 1800)
    return () => window.clearTimeout(timer)
  }, [activeId])

  async function addBusiness() {
    const name = window.prompt('Nombre del nuevo negocio o empresa:')?.trim()
    if (!name) return
    const company = await createCompany(name)
    await load()
    onChange(company.id)
  }

  return <div className="businessSwitcher">
    <Building2 size={16}/><span>Negocio</span>
    <select aria-label="Negocio activo" value={activeId} onChange={event => onChange(Number(event.target.value))}>{companies.map(company => <option key={company.id} value={company.id}>{company.name || `Negocio ${company.id}`}</option>)}</select>
    <button title="Agregar otro negocio" onClick={() => void addBusiness()}><Plus size={16}/><span>Agregar</span></button>
  </div>
}

function WorkspaceShell() {
  const [workspace, setWorkspace] = useState<Workspace>('billing')
  const [companyId, setCompanyId] = useState(getActiveCompanyId())
  const [company, setCompany] = useState<Company | null>(null)

  async function loadCompany(id = companyId) {
    await ensureCompany()
    const row = await db.company.get(id) || await db.company.get(1) || null
    setCompany(row)
  }

  useEffect(() => { void loadCompany(companyId) }, [companyId])

  function changeCompany(id: number) {
    if (!id || id === companyId) return
    setActiveCompanyId(id)
    setCompanyId(id)
    setWorkspace('billing')
  }

  const profile = (company?.businessProfile || 'services') as BusinessProfileKey
  const enabledModules = useMemo(() => new Set<BusinessModuleKey>(company?.enabledModules?.length ? company.enabledModules : modulesForProfile(profile)), [company, profile])
  const showCatalog = enabledModules.has('catalog')
  const showDeliveryNotes = enabledModules.has('delivery_notes')
  const showEducation = enabledModules.has('education_enrollment')

  const openEducation = () => window.dispatchEvent(new Event('zivifactura:open-education'))
  const openHelp = () => window.dispatchEvent(new Event('zivifactura:open-help'))

  return <>
    <div className="businessBar"><BusinessSwitcher activeId={companyId} onChange={changeCompany}/><span className="businessScopeNotice">{company?.name || 'Negocio activo'} · {labelForProfile(profile)}</span></div>
    <nav className="workspaceNav" aria-label="Áreas administrativas">
      <button data-workspace="billing" className={workspace === 'billing' ? 'active' : ''} onClick={() => setWorkspace('billing')}><ReceiptText size={17}/>Facturación</button>
      <button data-workspace="receivables" className={workspace === 'receivables' ? 'active' : ''} onClick={() => setWorkspace('receivables')}><DollarSign size={17}/>Por cobrar</button>
      <button data-workspace="payments" className={workspace === 'payments' ? 'active' : ''} onClick={() => setWorkspace('payments')}><WalletCards size={17}/>Cobros / Caja</button>
      <button data-workspace="income" className={workspace === 'income' ? 'active' : ''} onClick={() => setWorkspace('income')}><Wallet size={17}/>Ingresos</button>
      <button data-workspace="stats" className={workspace === 'stats' ? 'active' : ''} onClick={() => setWorkspace('stats')}><BarChart3 size={17}/>Estadísticas</button>
      {showCatalog && <button data-workspace="catalog" className={`workspaceModule ${workspace === 'catalog' ? 'active' : ''}`} onClick={() => setWorkspace('catalog')}><Package size={17}/>Catálogo</button>}
      {showDeliveryNotes && <button data-workspace="deliveryNotes" className={`workspaceModule ${workspace === 'deliveryNotes' ? 'active' : ''}`} onClick={() => setWorkspace('deliveryNotes')}><ClipboardList size={17}/>Notas de entrega</button>}
      {showEducation && <button className="workspaceModule" onClick={openEducation}><GraduationCap size={17}/>Educación</button>}
      <button data-workspace="profile" className={`workspaceModule ${workspace === 'profile' ? 'active' : ''}`} onClick={() => setWorkspace('profile')}><Settings2 size={17}/>Perfil</button>
      <button className="workspaceUtility" onClick={openHelp}><HelpCircle size={17}/>Ayuda</button>
    </nav>
    {workspace === 'billing' ? <App key={`billing-${companyId}`}/>
      : workspace === 'receivables' ? <ReceivablesView key={`receivables-${companyId}`}/>
      : workspace === 'payments' ? <PaymentsView key={`payments-${companyId}`}/>
      : workspace === 'income' || workspace === 'stats' ? <AdminDashboard key={`${workspace}-${companyId}`} view={workspace}/>
      : workspace === 'catalog' ? <CatalogView key={`catalog-${companyId}`}/>
      : workspace === 'deliveryNotes' ? <DeliveryNotesView key={`delivery-${companyId}`}/>
      : <BusinessProfileView key={`profile-${companyId}`} onChanged={updated => setCompany(updated)}/>} 
  </>
}

export default function AuthShellV2() {
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [authReady, setAuthReady] = useState(!firebaseConfigured)
  const [localOnly, setLocalOnly] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [verifiedOverride, setVerifiedOverride] = useState(false)

  useEffect(() => observeAuth(next => {
    setUser(next)
    setVerifiedOverride(false)
    setAuthReady(true)
    if (next) setLocalOnly(false)
  }), [])

  const verificationRequired = Boolean(user && isPasswordAccount(user) && !user.emailVerified && !verifiedOverride)

  useEffect(() => {
    if (!user || !firebaseConfigured || verificationRequired) return
    let cleanup = () => undefined
    let cancelled = false
    void prepareLocalAccount(user.uid).then(() => {
      if (cancelled) return
      cleanup = startFirebaseSync(user.uid, (state, message) => {
        setSyncState(state)
        setSyncMessage(message || '')
      })
    })
    return () => {
      cancelled = true
      cleanup()
    }
  }, [user, verificationRequired])

  async function logout() {
    if (user && !verificationRequired) {
      try { await syncFirebaseNow(user.uid) } catch { /* the local copy remains available */ }
    }
    await signOutFirebase()
  }

  if (!firebaseConfigured || localOnly) return <><WorkspaceShell/><footer className="appLegalFooter"><LegalLinks compact/></footer></>
  if (!authReady) return <main className="authLoading"><div className="authSpinner"/><strong>Preparando ZiviFactura…</strong></main>
  if (!user) return <LoginScreen onLocal={() => setLocalOnly(true)}/>
  if (verificationRequired) return <VerifyEmailScreen user={user} onVerified={() => setVerifiedOverride(true)} onLogout={() => void logout()}/>

  return <>
    <AccountBar user={user} state={syncState} message={syncMessage} onLogout={logout}/>
    <WorkspaceShell/>
    <footer className="appLegalFooter"><LegalLinks compact/></footer>
  </>
}
