-- Generada por scripts/nueva_migracion_postgres.js el 2026-10-21
-- comparando prisma/postgres/schema.prisma del ultimo commit con prisma/postgres/schema.prisma.
-- Revisala antes de aplicarla (npm run db:migrate): Prisma no sabe migrar
-- datos, solo estructura; si hay que convertir valores, agregalo aqui.
-- AlterTable
ALTER TABLE "articulos_conocimiento" ADD COLUMN     "restringido" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "archivos_conocimiento" ADD COLUMN     "restringido" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "accesos_conocimiento" (
    "id" SERIAL NOT NULL,
    "articulo_id" INTEGER,
    "archivo_id" VARCHAR(36),
    "area" VARCHAR(40),
    "rol" VARCHAR(10),
    "usuario_id" INTEGER,

    CONSTRAINT "accesos_conocimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accesos_conocimiento_articulo_id_idx" ON "accesos_conocimiento"("articulo_id");

-- CreateIndex
CREATE INDEX "accesos_conocimiento_archivo_id_idx" ON "accesos_conocimiento"("archivo_id");

-- CreateIndex
CREATE INDEX "accesos_conocimiento_usuario_id_idx" ON "accesos_conocimiento"("usuario_id");

-- AddForeignKey
ALTER TABLE "accesos_conocimiento" ADD CONSTRAINT "accesos_conocimiento_articulo_id_fkey" FOREIGN KEY ("articulo_id") REFERENCES "articulos_conocimiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_conocimiento" ADD CONSTRAINT "accesos_conocimiento_archivo_id_fkey" FOREIGN KEY ("archivo_id") REFERENCES "archivos_conocimiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_conocimiento" ADD CONSTRAINT "accesos_conocimiento_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
