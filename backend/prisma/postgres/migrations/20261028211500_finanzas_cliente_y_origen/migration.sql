-- Generada el 2026-10-28 con `prisma migrate diff` entre prisma/postgres/schema.prisma
-- con acceso_cotizaciones y el nuevo (cliente y origen en finanzas).
-- Revisala antes de aplicarla (npm run db:migrate): Prisma no sabe migrar
-- datos, solo estructura; si hay que convertir valores, agregalo aqui.
-- AlterTable
ALTER TABLE "gastos" ADD COLUMN     "cliente_id" INTEGER;

-- AlterTable
ALTER TABLE "comprobantes_financieros" ADD COLUMN     "adjunto_id" INTEGER,
ADD COLUMN     "origen" VARCHAR(255),
ADD COLUMN     "origen_proyecto_id" INTEGER,
ADD COLUMN     "origen_tarea_id" INTEGER;

-- AlterTable
ALTER TABLE "cotizaciones" ADD COLUMN     "cliente_id" INTEGER;

-- AlterTable
ALTER TABLE "versiones_cotizacion" ADD COLUMN     "adjunto_id" INTEGER,
ADD COLUMN     "origen" VARCHAR(255),
ADD COLUMN     "origen_proyecto_id" INTEGER,
ADD COLUMN     "origen_tarea_id" INTEGER;

-- CreateIndex
CREATE INDEX "gastos_cliente_id_idx" ON "gastos"("cliente_id");

-- CreateIndex
CREATE INDEX "comprobantes_financieros_adjunto_id_idx" ON "comprobantes_financieros"("adjunto_id");

-- CreateIndex
CREATE INDEX "cotizaciones_cliente_id_idx" ON "cotizaciones"("cliente_id");

-- CreateIndex
CREATE INDEX "versiones_cotizacion_adjunto_id_idx" ON "versiones_cotizacion"("adjunto_id");

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

