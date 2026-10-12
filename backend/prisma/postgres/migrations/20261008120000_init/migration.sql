-- Esquema inicial para PostgreSQL (Supabase o Postgres local), generado con
-- `prisma migrate diff --from-empty --to-schema-datamodel prisma/postgres/schema.prisma`
-- a partir del modelo del 2026-10-08. Equivale a las diez migraciones de MySQL
-- (prisma/migrations/) juntas. Las migraciones anteriores de Supabase (mayo a
-- agosto de 2026) ya no aplican: una base de Supabase con ese esquema viejo se
-- vacia primero y se le copian los datos con scripts/copiar_base.js (ver README).

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMIN', 'MIEMBRO', 'CONFIGURADOR', 'CLIENTE');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "telefono" TEXT,
    "puesto" VARCHAR(255),
    "biografia" TEXT,
    "foto_perfil_url" TEXT,
    "area" VARCHAR(40) NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'MIEMBRO',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetToken" TEXT,
    "resetTokenExpires" TIMESTAMP(3),
    "verificado" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "verificationTokenExpires" TIMESTAMP(3),
    "estado" TEXT DEFAULT 'pendiente',
    "token_invitacion" TEXT,
    "token_expira_en" TIMESTAMP(3),
    "password_hash" TEXT,
    "google_calendar_email" TEXT,
    "google_access_token" TEXT,
    "google_refresh_token" TEXT,
    "google_token_expires_at" TIMESTAMP(3),
    "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_hasta" TIMESTAMP(3),
    "ultimo_login_en" TIMESTAMP(3),
    "password_cambiado_en" TIMESTAMP(3),
    "verificacion_intentos" INTEGER NOT NULL DEFAULT 0,
    "dos_factores_activo" BOOLEAN NOT NULL DEFAULT false,
    "dos_factores_secreto" TEXT,
    "dos_factores_pendiente" TEXT,
    "dos_factores_ultimo_paso" INTEGER,
    "codigos_respaldo" JSONB,
    "empresa_id" INTEGER,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" VARCHAR(36) NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "refresh_hash" VARCHAR(64) NOT NULL,
    "refresh_hash_anterior" VARCHAR(64),
    "rotado_en" TIMESTAMP(3),
    "recordar" BOOLEAN NOT NULL DEFAULT false,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_uso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "revocada_en" TIMESTAMP(3),

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_seguridad" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER,
    "email" VARCHAR(191),
    "tipo" VARCHAR(64) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "detalle" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_seguridad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contratos" (
    "id" SERIAL NOT NULL,
    "folio" VARCHAR(40) NOT NULL,
    "titulo" VARCHAR(255) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "categoria" VARCHAR(40),
    "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    "contraparte_nombre" VARCHAR(255) NOT NULL,
    "contraparte_rfc" VARCHAR(13),
    "contraparte_contacto" VARCHAR(255),
    "contraparte_email" VARCHAR(191),
    "contraparte_telefono" VARCHAR(40),
    "descripcion" TEXT,
    "monto" DECIMAL(14,2),
    "moneda" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "incluye_iva" BOOLEAN NOT NULL DEFAULT false,
    "periodicidad_pago" VARCHAR(20),
    "fecha_firma" DATE,
    "fecha_inicio" DATE,
    "fecha_fin" DATE,
    "renovacion_automatica" BOOLEAN NOT NULL DEFAULT false,
    "dias_aviso" INTEGER NOT NULL DEFAULT 30,
    "notas" TEXT,
    "proyecto_id" INTEGER,
    "empresa_id" INTEGER,
    "responsable_id" INTEGER,
    "creado_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contratos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresas" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "nombre_comercial" VARCHAR(255),
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'CLIENTE',
    "estado" VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    "rfc" VARCHAR(13),
    "sector" VARCHAR(80),
    "sitio_web" VARCHAR(255),
    "email" VARCHAR(191),
    "telefono" VARCHAR(40),
    "direccion" VARCHAR(500),
    "ciudad" VARCHAR(120),
    "notas" TEXT,
    "creado_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contactos_empresa" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "puesto" VARCHAR(120),
    "email" VARCHAR(191),
    "telefono" VARCHAR(40),
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contactos_empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contrato_archivos" (
    "id" VARCHAR(36) NOT NULL,
    "contrato_id" INTEGER NOT NULL,
    "nombre_original" VARCHAR(255) NOT NULL,
    "archivo" VARCHAR(80) NOT NULL,
    "tamano" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "tipo_documento" VARCHAR(20) NOT NULL DEFAULT 'FIRMADO',
    "subido_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contrato_archivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "datos" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "actualizado_por_id" INTEGER,

    CONSTRAINT "configuracion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_archivos" (
    "clave" VARCHAR(40) NOT NULL,
    "mime" VARCHAR(60) NOT NULL,
    "contenido" BYTEA NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_archivos_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "invitaciones" (
    "id" VARCHAR(36) NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "area" TEXT NOT NULL,
    "rol" TEXT NOT NULL DEFAULT 'miembro',
    "token" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "creado_por" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "empresa_id" INTEGER,

    CONSTRAINT "invitaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proyectos" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadorId" INTEGER NOT NULL,
    "area" TEXT NOT NULL DEFAULT 'DESARROLLO',
    "fechaFin" TIMESTAMP(3),
    "fechaInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cliente_id" INTEGER,

    CONSTRAINT "proyectos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantillas_proyecto" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "area" TEXT NOT NULL DEFAULT 'DESARROLLO',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadorId" INTEGER NOT NULL,
    "proyectoBaseId" INTEGER,

    CONSTRAINT "plantillas_proyecto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantillas_tarea" (
    "id" SERIAL NOT NULL,
    "plantillaId" INTEGER NOT NULL,
    "clave" TEXT NOT NULL,
    "titulo" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "prioridad" TEXT NOT NULL DEFAULT 'MEDIA',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "offsetInicioDias" INTEGER NOT NULL DEFAULT 0,
    "offsetVenceDias" INTEGER,
    "dependeDeClave" TEXT,

    CONSTRAINT "plantillas_tarea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tareas" (
    "id" SERIAL NOT NULL,
    "titulo" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "numeroActividad" INTEGER,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "prioridad" TEXT NOT NULL DEFAULT 'MEDIA',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completadoEn" TIMESTAMP(3),
    "venceEn" TIMESTAMP(3),
    "proyectoId" INTEGER NOT NULL,
    "asignadoId" INTEGER,
    "creadorId" INTEGER,
    "dependeDeId" INTEGER,
    "fechaInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tareas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" SERIAL NOT NULL,
    "mensaje" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER NOT NULL,
    "tareaId" INTEGER,
    "proyectoId" INTEGER,
    "eventoId" VARCHAR(36),
    "actorNombre" VARCHAR(255),

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comentarios" (
    "id" SERIAL NOT NULL,
    "contenido" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autorId" INTEGER NOT NULL,
    "tareaId" INTEGER,
    "proyectoId" INTEGER,

    CONSTRAINT "comentarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs_actividad" (
    "id" SERIAL NOT NULL,
    "accion" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER NOT NULL,
    "proyectoId" INTEGER NOT NULL,
    "tareaId" INTEGER,

    CONSTRAINT "logs_actividad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjuntos" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "url" TEXT NOT NULL,
    "tipo" TEXT,
    "tamano" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER NOT NULL,
    "tareaId" INTEGER,
    "proyectoId" INTEGER,
    "eventoId" VARCHAR(36),
    "visible_cliente" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "adjuntos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos" (
    "id" VARCHAR(36) NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "titulo" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "tipo" TEXT NOT NULL,
    "modalidad" TEXT NOT NULL DEFAULT 'presencial',
    "ubicacion" VARCHAR(255),
    "url_reunion" TEXT,
    "instrucciones_acceso" TEXT,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3),
    "todo_el_dia" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT NOT NULL DEFAULT '#4a90d9',
    "alerta_minutos" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "es_compartido" BOOLEAN NOT NULL DEFAULT false,
    "es_global" BOOLEAN NOT NULL DEFAULT false,
    "proyecto_id" INTEGER,
    "creado_por_id" INTEGER,
    "es_recurrente" BOOLEAN NOT NULL DEFAULT false,
    "patron_recurrencia" TEXT,
    "fecha_fin_recurrencia" TIMESTAMP(3),
    "google_calendar_event_id" VARCHAR(255),
    "empresa_id" INTEGER,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_invitados" (
    "id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "visto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "evento_invitados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendario_laboral" (
    "id" VARCHAR(36) NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "dias_laborales" JSONB NOT NULL,
    "hora_entrada" TEXT NOT NULL DEFAULT '09:00',
    "hora_salida" TEXT NOT NULL DEFAULT '18:00',
    "hora_comida_inicio" TEXT NOT NULL DEFAULT '14:00',
    "hora_comida_fin" TEXT NOT NULL DEFAULT '15:00',
    "horarios_por_dia" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendario_laboral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dias_especiales" (
    "id" VARCHAR(36) NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT,
    "hora_inicio" VARCHAR(5),
    "hora_fin" VARCHAR(5),

    CONSTRAINT "dias_especiales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensajes_portal" (
    "id" SERIAL NOT NULL,
    "proyecto_id" INTEGER NOT NULL,
    "autor_id" INTEGER NOT NULL,
    "contenido" TEXT NOT NULL,
    "de_cliente" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajes_portal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dias_empresa" (
    "id" VARCHAR(36) NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" TEXT,
    "repetir_anual" BOOLEAN NOT NULL DEFAULT false,
    "dias_semana" JSONB,
    "area" VARCHAR(40),
    "creado_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dias_empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avisos_enviados" (
    "clave" VARCHAR(191) NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avisos_enviados_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "_ProyectoMiembro" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_AsignadosMultiplesTarea" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_token_invitacion_key" ON "usuarios"("token_invitacion");

-- CreateIndex
CREATE INDEX "usuarios_empresa_id_idx" ON "usuarios"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_refresh_hash_key" ON "sesiones"("refresh_hash");

-- CreateIndex
CREATE INDEX "sesiones_usuario_id_idx" ON "sesiones"("usuario_id");

-- CreateIndex
CREATE INDEX "sesiones_refresh_hash_anterior_idx" ON "sesiones"("refresh_hash_anterior");

-- CreateIndex
CREATE INDEX "eventos_seguridad_usuario_id_creado_en_idx" ON "eventos_seguridad"("usuario_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "contratos_folio_key" ON "contratos"("folio");

-- CreateIndex
CREATE INDEX "contratos_tipo_idx" ON "contratos"("tipo");

-- CreateIndex
CREATE INDEX "contratos_estado_idx" ON "contratos"("estado");

-- CreateIndex
CREATE INDEX "contratos_fecha_fin_idx" ON "contratos"("fecha_fin");

-- CreateIndex
CREATE INDEX "contratos_empresa_id_idx" ON "contratos"("empresa_id");

-- CreateIndex
CREATE INDEX "empresas_tipo_idx" ON "empresas"("tipo");

-- CreateIndex
CREATE INDEX "empresas_nombre_idx" ON "empresas"("nombre");

-- CreateIndex
CREATE INDEX "contactos_empresa_empresa_id_idx" ON "contactos_empresa"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "contrato_archivos_archivo_key" ON "contrato_archivos"("archivo");

-- CreateIndex
CREATE INDEX "contrato_archivos_contrato_id_idx" ON "contrato_archivos"("contrato_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitaciones_token_key" ON "invitaciones"("token");

-- CreateIndex
CREATE INDEX "invitaciones_empresa_id_idx" ON "invitaciones"("empresa_id");

-- CreateIndex
CREATE INDEX "proyectos_cliente_id_idx" ON "proyectos"("cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "plantillas_tarea_plantillaId_clave_key" ON "plantillas_tarea"("plantillaId", "clave");

-- CreateIndex
CREATE INDEX "tareas_asignadoId_idx" ON "tareas"("asignadoId");

-- CreateIndex
CREATE INDEX "tareas_creadorId_idx" ON "tareas"("creadorId");

-- CreateIndex
CREATE INDEX "tareas_estado_idx" ON "tareas"("estado");

-- CreateIndex
CREATE INDEX "tareas_proyectoId_numeroActividad_idx" ON "tareas"("proyectoId", "numeroActividad");

-- CreateIndex
CREATE INDEX "eventos_empresa_id_idx" ON "eventos"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "evento_invitados_evento_id_usuario_id_key" ON "evento_invitados"("evento_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendario_laboral_usuario_id_key" ON "calendario_laboral"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "dias_especiales_usuario_id_fecha_key" ON "dias_especiales"("usuario_id", "fecha");

-- CreateIndex
CREATE INDEX "mensajes_portal_proyecto_id_creado_en_idx" ON "mensajes_portal"("proyecto_id", "creado_en");

-- CreateIndex
CREATE INDEX "mensajes_portal_autor_id_idx" ON "mensajes_portal"("autor_id");

-- CreateIndex
CREATE INDEX "dias_empresa_fecha_inicio_idx" ON "dias_empresa"("fecha_inicio");

-- CreateIndex
CREATE INDEX "avisos_enviados_creado_en_idx" ON "avisos_enviados"("creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "_ProyectoMiembro_AB_unique" ON "_ProyectoMiembro"("A", "B");

-- CreateIndex
CREATE INDEX "_ProyectoMiembro_B_index" ON "_ProyectoMiembro"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_AsignadosMultiplesTarea_AB_unique" ON "_AsignadosMultiplesTarea"("A", "B");

-- CreateIndex
CREATE INDEX "_AsignadosMultiplesTarea_B_index" ON "_AsignadosMultiplesTarea"("B");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_seguridad" ADD CONSTRAINT "eventos_seguridad_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactos_empresa" ADD CONSTRAINT "contactos_empresa_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrato_archivos" ADD CONSTRAINT "contrato_archivos_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrato_archivos" ADD CONSTRAINT "contrato_archivos_subido_por_id_fkey" FOREIGN KEY ("subido_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_creadorId_fkey" FOREIGN KEY ("creadorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantillas_proyecto" ADD CONSTRAINT "plantillas_proyecto_creadorId_fkey" FOREIGN KEY ("creadorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantillas_proyecto" ADD CONSTRAINT "plantillas_proyecto_proyectoBaseId_fkey" FOREIGN KEY ("proyectoBaseId") REFERENCES "proyectos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantillas_tarea" ADD CONSTRAINT "plantillas_tarea_plantillaId_fkey" FOREIGN KEY ("plantillaId") REFERENCES "plantillas_proyecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_asignadoId_fkey" FOREIGN KEY ("asignadoId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_creadorId_fkey" FOREIGN KEY ("creadorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_dependeDeId_fkey" FOREIGN KEY ("dependeDeId") REFERENCES "tareas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_proyectoId_fkey" FOREIGN KEY ("proyectoId") REFERENCES "proyectos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "tareas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_proyectoId_fkey" FOREIGN KEY ("proyectoId") REFERENCES "proyectos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "eventos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios" ADD CONSTRAINT "comentarios_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios" ADD CONSTRAINT "comentarios_proyectoId_fkey" FOREIGN KEY ("proyectoId") REFERENCES "proyectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios" ADD CONSTRAINT "comentarios_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "tareas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs_actividad" ADD CONSTRAINT "logs_actividad_proyectoId_fkey" FOREIGN KEY ("proyectoId") REFERENCES "proyectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs_actividad" ADD CONSTRAINT "logs_actividad_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "tareas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs_actividad" ADD CONSTRAINT "logs_actividad_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_proyectoId_fkey" FOREIGN KEY ("proyectoId") REFERENCES "proyectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "tareas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_invitados" ADD CONSTRAINT "evento_invitados_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_invitados" ADD CONSTRAINT "evento_invitados_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendario_laboral" ADD CONSTRAINT "calendario_laboral_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dias_especiales" ADD CONSTRAINT "dias_especiales_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_portal" ADD CONSTRAINT "mensajes_portal_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_portal" ADD CONSTRAINT "mensajes_portal_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dias_empresa" ADD CONSTRAINT "dias_empresa_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProyectoMiembro" ADD CONSTRAINT "_ProyectoMiembro_A_fkey" FOREIGN KEY ("A") REFERENCES "proyectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProyectoMiembro" ADD CONSTRAINT "_ProyectoMiembro_B_fkey" FOREIGN KEY ("B") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AsignadosMultiplesTarea" ADD CONSTRAINT "_AsignadosMultiplesTarea_A_fkey" FOREIGN KEY ("A") REFERENCES "tareas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AsignadosMultiplesTarea" ADD CONSTRAINT "_AsignadosMultiplesTarea_B_fkey" FOREIGN KEY ("B") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

