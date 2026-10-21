-- Base de conocimiento: acceso por articulo y por archivo. Cada uno puede
-- quedar restringido a una lista de areas, roles y personas (tabla
-- accesos_conocimiento). Generada con `prisma migrate diff`.
-- AlterTable
ALTER TABLE `articulos_conocimiento` ADD COLUMN `restringido` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `archivos_conocimiento` ADD COLUMN `restringido` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `accesos_conocimiento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `articulo_id` INTEGER NULL,
    `archivo_id` VARCHAR(36) NULL,
    `area` VARCHAR(40) NULL,
    `rol` VARCHAR(10) NULL,
    `usuario_id` INTEGER NULL,

    INDEX `accesos_conocimiento_articulo_id_idx`(`articulo_id`),
    INDEX `accesos_conocimiento_archivo_id_idx`(`archivo_id`),
    INDEX `accesos_conocimiento_usuario_id_idx`(`usuario_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `accesos_conocimiento` ADD CONSTRAINT `accesos_conocimiento_articulo_id_fkey` FOREIGN KEY (`articulo_id`) REFERENCES `articulos_conocimiento`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accesos_conocimiento` ADD CONSTRAINT `accesos_conocimiento_archivo_id_fkey` FOREIGN KEY (`archivo_id`) REFERENCES `archivos_conocimiento`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accesos_conocimiento` ADD CONSTRAINT `accesos_conocimiento_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

