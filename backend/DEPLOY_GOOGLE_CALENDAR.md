# Deploy Google Calendar

Para que la sincronización con Google Calendar funcione en servidor, configura esto en tu despliegue.

## Backend

Variables requeridas en el proyecto del backend:

```env
DATABASE_URL=
JWT_SECRET=
FRONTEND_URL=https://tu-frontend.vercel.app
GOOGLE_CLIENT_ID=494053723857-fhhrj0pi24rb7ppe43p4uqljti7ch9gp.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=TU_GOOGLE_CLIENT_SECRET
```

Notas:

- `FRONTEND_URL` debe apuntar al dominio real del frontend en producción.
- Las migraciones se aplican manualmente con conexión directa antes del deploy; Vercel solo ejecuta `prisma generate` para evitar builds lentos con el pooler.

## Frontend

Variables requeridas en el proyecto del frontend:

```env
VITE_API_URL=https://tu-backend.vercel.app/api
VITE_GOOGLE_CLIENT_ID=494053723857-fhhrj0pi24rb7ppe43p4uqljti7ch9gp.apps.googleusercontent.com
```

## Google Cloud Console

En tu OAuth Client de Google agrega estos valores:

### Authorized JavaScript origins

```txt
http://localhost:5173
https://tu-frontend.vercel.app
```

### Authorized redirect URIs

No hace falta agregar uno extra para este flujo porque el frontend usa `Google Identity Services` con `popup` y el backend intercambia el código con `redirect_uri=postmessage`.

## Después del deploy

1. Redeploy del backend.
2. Redeploy del frontend.
3. Entra al CRM.
4. Abre Configuración de Agenda.
5. Conecta Google Calendar.

## Si falla en producción

Revisa estos puntos:

- `VITE_GOOGLE_CLIENT_ID` debe existir en el build del frontend.
- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` deben existir en el backend.
- `FRONTEND_URL` debe coincidir con tu dominio real.
- El dominio del frontend debe estar autorizado en Google Cloud.
