import { getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, onAuthStateChanged, reload, sendEmailVerification, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, updateProfile, type User } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Firebase Web config is safe to ship in the client. Environment variables still
// take precedence so the deployment can override these values without code changes.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyBuuntT-Bpk_-tlKslOG5a2UeqPenCQ6uk',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'zivifactura.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'zivifactura',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'zivifactura.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '276549383437',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:276549383437:web:212612caed5710d9ddec44',
}

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId,
)

const firebaseApp = firebaseConfigured
  ? (getApps()[0] || initializeApp(firebaseConfig))
  : null

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null
export const firestore = firebaseApp ? getFirestore(firebaseApp) : null

if (firebaseAuth) {
  firebaseAuth.languageCode = 'es'
  setPersistence(firebaseAuth, browserLocalPersistence).catch(() => undefined)
}

export type VerificationEmailStatus = {
  ok: boolean
  email: string
  at: string
  code?: string
  message?: string
}

const VERIFICATION_STATUS_KEY = 'zivifactura.verification-email-status'

function saveVerificationEmailStatus(status: VerificationEmailStatus) {
  try { sessionStorage.setItem(VERIFICATION_STATUS_KEY, JSON.stringify(status)) } catch { /* optional diagnostic state */ }
}

export function readVerificationEmailStatus() {
  try {
    const raw = sessionStorage.getItem(VERIFICATION_STATUS_KEY)
    return raw ? JSON.parse(raw) as VerificationEmailStatus : null
  } catch {
    return null
  }
}

const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export function observeAuth(callback: (user: User | null) => void) {
  if (!firebaseAuth) {
    callback(null)
    return () => undefined
  }
  return onAuthStateChanged(firebaseAuth, callback)
}

export async function signInWithGoogle() {
  if (!firebaseAuth) throw new Error('Firebase todavía no está configurado.')
  try {
    return await signInWithPopup(firebaseAuth, googleProvider)
  } catch (error) {
    const code = (error as { code?: string })?.code || ''
    if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(firebaseAuth, googleProvider)
      return null
    }
    throw error
  }
}

export async function signInWithEmail(email: string, password: string) {
  if (!firebaseAuth) throw new Error('Firebase todavía no está configurado.')
  return signInWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password)
}

export async function createEmailAccount(name: string, email: string, password: string) {
  if (!firebaseAuth) throw new Error('Firebase todavía no está configurado.')
  const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password)
  if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() })
  return credential
}

export function isPasswordAccount(user: User) {
  return user.providerData.some(provider => provider.providerId === 'password')
}

export async function sendAccountVerification(user?: User | null) {
  const target = user || firebaseAuth?.currentUser
  if (!target) throw new Error('No hay una cuenta activa para verificar.')
  if (target.emailVerified || !isPasswordAccount(target)) return

  const email = target.email || ''
  try {
    // Do not attach a continueUrl here. Verification does not require one and
    // using window.location.origin makes delivery depend on Firebase Authorized
    // Domains configuration. The default Firebase action handler is sufficient.
    await sendEmailVerification(target)
    saveVerificationEmailStatus({ ok: true, email, at: new Date().toISOString() })
  } catch (error) {
    const code = (error as { code?: string })?.code || ''
    const message = error instanceof Error ? error.message : String(error || 'No se pudo enviar el correo.')
    saveVerificationEmailStatus({ ok: false, email, at: new Date().toISOString(), code, message })
    throw error
  }
}

export async function refreshAccountVerification(user?: User | null) {
  const target = user || firebaseAuth?.currentUser
  if (!target) return false
  await reload(target)
  return target.emailVerified
}

export async function requestPasswordReset(email: string) {
  if (!firebaseAuth) throw new Error('Firebase todavía no está configurado.')
  // Password reset also works without a custom continueUrl and therefore does
  // not depend on the Vercel domain being present in Firebase Authorized Domains.
  await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase())
}

export async function signOutFirebase() {
  if (firebaseAuth) await signOut(firebaseAuth)
}

export type FirebaseUser = User
