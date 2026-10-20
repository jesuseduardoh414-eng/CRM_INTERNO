-- Google Drive en los dos sentidos para los adjuntos de proyectos y tareas:
-- carpeta de cada proyecto y tarea en Drive, id del archivo de cada adjunto
-- y, en la conexion, el permiso dado, la carpeta Proyectos y la marca de la
-- lista de cambios de Drive. Generada con `prisma migrate diff`.
-- AlterTable
ALTER TABLE `proyectos` ADD COLUMN `drive_carpeta_id` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `tareas` ADD COLUMN `drive_carpeta_id` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `adjuntos` ADD COLUMN `desde_drive` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `drive_archivo_id` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `conexion_drive` ADD COLUMN `alcance` VARCHAR(500) NULL,
    ADD COLUMN `cambios_en` DATETIME(3) NULL,
    ADD COLUMN `cambios_token` VARCHAR(255) NULL,
    ADD COLUMN `proyectos_carpeta_id` VARCHAR(100) NULL;

-- CreateIndex
CREATE INDEX `adjuntos_drive_archivo_id_idx` ON `adjuntos`(`drive_archivo_id`);

