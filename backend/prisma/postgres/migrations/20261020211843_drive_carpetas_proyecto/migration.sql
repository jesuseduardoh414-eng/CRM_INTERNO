-- Generada por scripts/nueva_migracion_postgres.js el 2026-10-20
-- comparando prisma/postgres/schema.prisma del ultimo commit con prisma/postgres/schema.prisma.
-- Revisala antes de aplicarla (npm run db:migrate): Prisma no sabe migrar
-- datos, solo estructura; si hay que convertir valores, agregalo aqui.
-- AlterTable
ALTER TABLE "proyectos" ADD COLUMN     "drive_carpeta_id" VARCHAR(100);

-- AlterTable
ALTER TABLE "tareas" ADD COLUMN     "drive_carpeta_id" VARCHAR(100);

-- AlterTable
ALTER TABLE "adjuntos" ADD COLUMN     "desde_drive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "drive_archivo_id" VARCHAR(100);

-- AlterTable
ALTER TABLE "conexion_drive" ADD COLUMN     "alcance" VARCHAR(500),
ADD COLUMN     "cambios_en" TIMESTAMP(3),
ADD COLUMN     "cambios_token" VARCHAR(255),
ADD COLUMN     "proyectos_carpeta_id" VARCHAR(100);

-- CreateIndex
CREATE INDEX "adjuntos_drive_archivo_id_idx" ON "adjuntos"("drive_archivo_id");
