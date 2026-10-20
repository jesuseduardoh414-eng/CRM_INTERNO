-- Finanzas: cotizaciones con versiones de archivo que no se reemplazan (la
-- 1 es la original). Base de conocimiento: articulos con archivos adjuntos.
-- Generada con `prisma migrate diff` contra el esquema anterior; al final,
-- RLS como en 20261008120100 (Supabase).
-- CreateTable
CREATE TABLE "cotizaciones" (
    "id" SERIAL NOT NULL,
    "folio" VARCHAR(40) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "titulo" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "empresa_id" INTEGER,
    "contraparte_nombre" VARCHAR(255),
    "moneda" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "fecha" DATE NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "creado_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cotizaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versiones_cotizacion" (
    "id" SERIAL NOT NULL,
    "cotizacion_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "monto" DECIMAL(14,2),
    "nota" TEXT,
    "nombre_original" VARCHAR(255) NOT NULL,
    "archivo" VARCHAR(80) NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "tamano" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "subido_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versiones_cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articulos_conocimiento" (
    "id" SERIAL NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "categoria" VARCHAR(80) NOT NULL,
    "resumen" VARCHAR(300),
    "contenido" TEXT NOT NULL,
    "publicado" BOOLEAN NOT NULL DEFAULT true,
    "fijado" BOOLEAN NOT NULL DEFAULT false,
    "autor_id" INTEGER,
    "editado_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articulos_conocimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archivos_conocimiento" (
    "id" VARCHAR(36) NOT NULL,
    "articulo_id" INTEGER NOT NULL,
    "nombre_original" VARCHAR(255) NOT NULL,
    "archivo" VARCHAR(80) NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "tamano" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "subido_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archivos_conocimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cotizaciones_folio_key" ON "cotizaciones"("folio");

-- CreateIndex
CREATE INDEX "cotizaciones_tipo_idx" ON "cotizaciones"("tipo");

-- CreateIndex
CREATE INDEX "cotizaciones_estado_idx" ON "cotizaciones"("estado");

-- CreateIndex
CREATE INDEX "cotizaciones_fecha_idx" ON "cotizaciones"("fecha");

-- CreateIndex
CREATE INDEX "cotizaciones_empresa_id_idx" ON "cotizaciones"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "versiones_cotizacion_archivo_key" ON "versiones_cotizacion"("archivo");

-- CreateIndex
CREATE UNIQUE INDEX "versiones_cotizacion_cotizacion_id_numero_key" ON "versiones_cotizacion"("cotizacion_id", "numero");

-- CreateIndex
CREATE INDEX "articulos_conocimiento_categoria_idx" ON "articulos_conocimiento"("categoria");

-- CreateIndex
CREATE UNIQUE INDEX "archivos_conocimiento_archivo_key" ON "archivos_conocimiento"("archivo");

-- CreateIndex
CREATE INDEX "archivos_conocimiento_articulo_id_idx" ON "archivos_conocimiento"("articulo_id");

-- AddForeignKey
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versiones_cotizacion" ADD CONSTRAINT "versiones_cotizacion_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versiones_cotizacion" ADD CONSTRAINT "versiones_cotizacion_subido_por_id_fkey" FOREIGN KEY ("subido_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articulos_conocimiento" ADD CONSTRAINT "articulos_conocimiento_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articulos_conocimiento" ADD CONSTRAINT "articulos_conocimiento_editado_por_id_fkey" FOREIGN KEY ("editado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archivos_conocimiento" ADD CONSTRAINT "archivos_conocimiento_articulo_id_fkey" FOREIGN KEY ("articulo_id") REFERENCES "articulos_conocimiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archivos_conocimiento" ADD CONSTRAINT "archivos_conocimiento_subido_por_id_fkey" FOREIGN KEY ("subido_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seguridad a nivel de fila (ver 20261008120100_seguridad_filas_supabase).

ALTER TABLE "cotizaciones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "versiones_cotizacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "articulos_conocimiento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "archivos_conocimiento" ENABLE ROW LEVEL SECURITY;
