-- AlterTable
ALTER TABLE `usuarios` MODIFY `rol` ENUM('ADMIN', 'MIEMBRO', 'CONFIGURADOR') NOT NULL DEFAULT 'MIEMBRO';

-- CreateTable
CREATE TABLE `configuracion` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `datos` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `actualizado_en` DATETIME(3) NOT NULL,
    `actualizado_por_id` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `configuracion_archivos` (
    `clave` VARCHAR(40) NOT NULL,
    `mime` VARCHAR(60) NOT NULL,
    `contenido` MEDIUMBLOB NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `actualizado_en` DATETIME(3) NOT NULL,

    PRIMARY KEY (`clave`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

