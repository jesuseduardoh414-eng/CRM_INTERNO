-- Generada por scripts/nueva_migracion_postgres.js el 2026-10-28
-- comparando prisma/postgres/schema.prisma del ultimo commit con prisma/postgres/schema.prisma.
-- Revisala antes de aplicarla (npm run db:migrate): Prisma no sabe migrar
-- datos, solo estructura; si hay que convertir valores, agregalo aqui.
-- AlterTable
ALTER TABLE "cotizaciones" ADD COLUMN     "restringido" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "accesos_cotizacion" (
    "id" SERIAL NOT NULL,
    "cotizacion_id" INTEGER NOT NULL,
    "area" VARCHAR(40),
    "rol" VARCHAR(10),
    "usuario_id" INTEGER,

    CONSTRAINT "accesos_cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accesos_cotizacion_cotizacion_id_idx" ON "accesos_cotizacion"("cotizacion_id");

-- CreateIndex
CREATE INDEX "accesos_cotizacion_usuario_id_idx" ON "accesos_cotizacion"("usuario_id");

-- AddForeignKey
ALTER TABLE "accesos_cotizacion" ADD CONSTRAINT "accesos_cotizacion_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_cotizacion" ADD CONSTRAINT "accesos_cotizacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
