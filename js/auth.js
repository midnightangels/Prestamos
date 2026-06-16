// ─── AUTENTICACIÓN GOOGLE ───────────────────────────────────────────────────
// Reemplazá CLIENT_ID con el tuyo desde Google Cloud Console
const CLIENT_ID = '435637014005-jaer9ttmu0lkb02mpiu4vl1hkivcqrj4.apps.googleusercontent.com';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'profile',
  'email'
].join(' ');

let tokenClient = null;
let currentUser  = null;
let accessToken  = null;

function initGoogleAuth() {
  return new Promise((resolve) => {
    // Cargar Google Identity Services
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.error) { console.error(resp); return; }
          accessToken = resp.access_token;
          fetchUserInfo();
        }
      });

      // Verificar sesión previa
      const saved = localStorage.getItem('pp_user');
      const savedToken = localStorage.getItem('pp_token');
      if (saved && savedToken) {
        currentUser = JSON.parse(saved);
        accessToken = savedToken;
        resolve(currentUser);
      } else {
        resolve(null);
      }
    };
    document.head.appendChild(script);
  });
}

async function fetchUserInfo() {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    currentUser = await res.json();
    localStorage.setItem('pp_user',  JSON.stringify(currentUser));
    localStorage.setItem('pp_token', accessToken);
    window.dispatchEvent(new CustomEvent('auth:login', { detail: currentUser }));
  } catch (e) {
    console.error('Error obteniendo info de usuario:', e);
  }
}

function signIn() {
  if (!CLIENT_ID || CLIENT_ID.includes('TU_CLIENT_ID')) {
    alert('⚠️ Configurá tu CLIENT_ID de Google en js/auth.js antes de continuar.\n\nRevisar la sección CONFIGURACIÓN en la app.');
    return;
  }
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

function signOut() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken);
  }
  accessToken  = null;
  currentUser  = null;
  localStorage.removeItem('pp_user');
  localStorage.removeItem('pp_token');
  window.dispatchEvent(new CustomEvent('auth:logout'));
}

function getAccessToken() { return accessToken; }
function getCurrentUser()  { return currentUser; }
function isAuthenticated() { return !!accessToken && !!currentUser; }
