/* Configuración de la implementación. Edita este archivo con los datos de tu proyecto Firebase.
   La configuración web de Firebase no es secreta: la seguridad la dan las reglas de Firestore (firestore.rules). */
window.CONFIG = {
  firebase: {
    apiKey: 'AIzaSyAedCPwTxKiIJ3ZVsvw_hLH5ojp9lnBVFA',
    authDomain: 'fpt-calendario.firebaseapp.com',
    projectId: 'fpt-calendario',
    storageBucket: 'fpt-calendario.firebasestorage.app',
    messagingSenderId: '128042319066',
    appId: '1:128042319066:web:862591945018e2016f79e3',
  },
  // Administradora inicial (debe coincidir con bootstrapAdmin() en firestore.rules).
  // Después se administran desde la app: Configuración → Cuenta de administradora.
  adminInicial: 'jair@fpt.com.mx',
  // Dominios cuyos correos pueden consultar el calendario como Gerentes al iniciar (editable en la app).
  dominiosIniciales: [],
  // Muestra también el botón "Ingresar con Google" (requiere habilitar Google en Firebase Authentication).
  googleLogin: false,
};
