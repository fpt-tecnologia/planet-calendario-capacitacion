/* Configuración de la implementación. Edita este archivo con los datos de tu proyecto Firebase.
   La configuración web de Firebase no es secreta: la seguridad la dan las reglas de Firestore (firestore.rules). */
window.CONFIG = {
  firebase: {
    apiKey: 'PEGAR_API_KEY',
    authDomain: 'PEGAR_PROYECTO.firebaseapp.com',
    projectId: 'PEGAR_PROYECTO',
    storageBucket: 'PEGAR_PROYECTO.appspot.com',
    messagingSenderId: 'PEGAR',
    appId: 'PEGAR',
  },
  // Administradora inicial (debe coincidir con bootstrapAdmin() en firestore.rules).
  // Después se administran desde la app: Configuración → Cuenta de administradora.
  adminInicial: 'jair@fpt.com.mx',
  // Dominios cuyos correos pueden consultar el calendario como Gerentes al iniciar (editable en la app).
  dominiosIniciales: [],
  // Muestra también el botón "Ingresar con Google" (requiere habilitar Google en Firebase Authentication).
  googleLogin: false,
};
