-- Tesoreria: presupuesto mensual por categoria de gastos. Sustituye a las
-- partidas libres: las que existan se archivan y quedan como historial (sus
-- asignaciones ya no descuentan de la bolsa de ingresos). Generada con
-- `prisma migrate diff` contra el esquema del commit anterior; al final, RLS
-- como en 20261008120100 (Supabase) y el archivado de partidas.
-- CreateTable
CREATE TABLE "presupuestos_categoria" (
    "id" SERIAL NOT NULL,
    "categoria" VARCHAR(30) NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "fijado_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presupuestos_categoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "presupuestos_categoria_anio_mes_idx" ON "presupuestos_categoria"("anio", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "presupuestos_categoria_categoria_anio_mes_key" ON "presupuestos_categoria"("categoria", "anio", "mes");

-- AddForeignKey
ALTER TABLE "presupuestos_categoria" ADD CONSTRAINT "presupuestos_categoria_fijado_por_id_fkey" FOREIGN KEY ("fijado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seguridad a nivel de fila (ver 20261008120100_seguridad_filas_supabase).
ALTER TABLE "presupuestos_categoria" ENABLE ROW LEVEL SECURITY;

-- Archivar las partidas existentes
UPDATE "partidas" SET "activa" = false;
