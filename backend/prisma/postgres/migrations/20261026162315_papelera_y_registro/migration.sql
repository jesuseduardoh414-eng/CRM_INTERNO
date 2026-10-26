-- Generada por scripts/nueva_migracion_postgres.js el 2026-10-26
-- comparando prisma/postgres/schema.prisma del ultimo commit con prisma/postgres/schema.prisma.
-- Revisala antes de aplicarla (npm run db:migrate): Prisma no sabe migrar
-- datos, solo estructura; si hay que convertir valores, agregalo aqui.
-- CreateTable
CREATE TABLE "papelera" (
    "id" SERIAL NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "modulo" VARCHAR(40) NOT NULL,
    "entidad_id" VARCHAR(64),
    "nombre" VARCHAR(255) NOT NULL,
    "contexto" VARCHAR(255),
    "datos" JSONB NOT NULL,
    "archivos" JSONB,
    "origen" VARCHAR(20) NOT NULL DEFAULT 'usuario',
    "borrado_por_id" INTEGER,
    "borrado_por_nombre" VARCHAR(255),
    "borrado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "papelera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_actividad" (
    "id" SERIAL NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" INTEGER,
    "usuario_nombre" VARCHAR(255),
    "origen" VARCHAR(20) NOT NULL DEFAULT 'usuario',
    "accion" VARCHAR(20) NOT NULL,
    "modulo" VARCHAR(40) NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "entidad_id" VARCHAR(64),
    "entidad_nombre" VARCHAR(255),
    "cambios" JSONB,
    "ip" VARCHAR(64),

    CONSTRAINT "registro_actividad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "papelera_borrado_en_idx" ON "papelera"("borrado_en");

-- CreateIndex
CREATE INDEX "papelera_modulo_borrado_en_idx" ON "papelera"("modulo", "borrado_en");

-- CreateIndex
CREATE INDEX "registro_actividad_creado_en_idx" ON "registro_actividad"("creado_en");

-- CreateIndex
CREATE INDEX "registro_actividad_usuario_id_creado_en_idx" ON "registro_actividad"("usuario_id", "creado_en");

-- CreateIndex
CREATE INDEX "registro_actividad_modulo_creado_en_idx" ON "registro_actividad"("modulo", "creado_en");

-- AddForeignKey
ALTER TABLE "papelera" ADD CONSTRAINT "papelera_borrado_por_id_fkey" FOREIGN KEY ("borrado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_actividad" ADD CONSTRAINT "registro_actividad_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
