-- Google Calendar en los dos sentidos: calendario "OMNIS CRM" de cada persona
-- (id y marca de sincronizacion) y, por evento, el etag de Google para
-- reconocer el eco de los cambios del propio CRM. Generada con `prisma migrate diff`.
-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `google_calendar_crm_id` VARCHAR(255) NULL,
    ADD COLUMN `google_calendar_sync_en` DATETIME(3) NULL,
    ADD COLUMN `google_calendar_sync_token` TEXT NULL;

-- AlterTable
ALTER TABLE `eventos` ADD COLUMN `actualizado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `google_etag` VARCHAR(255) NULL;

-- CreateIndex
CREATE INDEX `eventos_usuarioId_google_calendar_event_id_idx` ON `eventos`(`usuarioId`, `google_calendar_event_id`);

