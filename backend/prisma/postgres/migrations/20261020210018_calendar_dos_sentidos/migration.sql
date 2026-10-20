-- Generada por scripts/nueva_migracion_postgres.js el 2026-10-20
-- comparando prisma/postgres/schema.prisma del ultimo commit con prisma/postgres/schema.prisma.
-- Revisala antes de aplicarla (npm run db:migrate): Prisma no sabe migrar
-- datos, solo estructura; si hay que convertir valores, agregalo aqui.
-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "google_calendar_crm_id" VARCHAR(255),
ADD COLUMN     "google_calendar_sync_en" TIMESTAMP(3),
ADD COLUMN     "google_calendar_sync_token" TEXT;

-- AlterTable
ALTER TABLE "eventos" ADD COLUMN     "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "google_etag" VARCHAR(255);

-- CreateIndex
CREATE INDEX "eventos_usuarioId_google_calendar_event_id_idx" ON "eventos"("usuarioId", "google_calendar_event_id");
