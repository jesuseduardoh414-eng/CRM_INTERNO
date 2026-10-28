-- Cotizaciones: cada una puede quedar solo para ciertas areas, roles o
-- personas (tabla accesos_cotizacion), como los articulos de la base de
-- conocimiento. Generada con `prisma migrate diff`.
-- AlterTable
ALTER TABLE `cotizaciones` ADD COLUMN `restringido` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `accesos_cotizacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cotizacion_id` INTEGER NOT NULL,
    `area` VARCHAR(40) NULL,
    `rol` VARCHAR(10) NULL,
    `usuario_id` INTEGER NULL,

    INDEX `accesos_cotizacion_cotizacion_id_idx`(`cotizacion_id`),
    INDEX `accesos_cotizacion_usuario_id_idx`(`usuario_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `accesos_cotizacion` ADD CONSTRAINT `accesos_cotizacion_cotizacion_id_fkey` FOREIGN KEY (`cotizacion_id`) REFERENCES `cotizaciones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accesos_cotizacion` ADD CONSTRAINT `accesos_cotizacion_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

