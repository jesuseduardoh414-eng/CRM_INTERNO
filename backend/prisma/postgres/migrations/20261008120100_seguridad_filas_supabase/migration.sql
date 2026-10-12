-- Seguridad a nivel de fila (RLS) en todas las tablas.
--
-- En Supabase, toda tabla del esquema `public` queda expuesta por la API REST
-- automatica (PostgREST) con la clave `anon`, que es publica. Con RLS activado
-- y sin politicas, `anon` y `authenticated` no ven ninguna fila; el backend no
-- se entera porque se conecta con el usuario `postgres`, dueño de las tablas,
-- y los dueños no pasan por RLS. En un Postgres propio es inofensivo.
--
-- Si algun dia se quiere Supabase Realtime en el frontend (VITE_ENABLE_REALTIME)
-- habra que agregar una politica de lectura sobre `notificaciones`.
-- Para deshacer: ALTER TABLE "tabla" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "usuarios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sesiones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eventos_seguridad" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contratos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "empresas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contactos_empresa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contrato_archivos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "configuracion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "configuracion_archivos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitaciones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proyectos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plantillas_proyecto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plantillas_tarea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tareas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notificaciones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comentarios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logs_actividad" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adjuntos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eventos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evento_invitados" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendario_laboral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dias_especiales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mensajes_portal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dias_empresa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "avisos_enviados" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_ProyectoMiembro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_AsignadosMultiplesTarea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
