-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `bloqueado_hasta` DATETIME(3) NULL,
    ADD COLUMN `codigos_respaldo` JSON NULL,
    ADD COLUMN `dos_factores_activo` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `dos_factores_pendiente` TEXT NULL,
    ADD COLUMN `dos_factores_secreto` TEXT NULL,
    ADD COLUMN `dos_factores_ultimo_paso` INTEGER NULL,
    ADD COLUMN `intentos_fallidos` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `password_cambiado_en` DATETIME(3) NULL,
    ADD COLUMN `ultimo_login_en` DATETIME(3) NULL,
    ADD COLUMN `verificacion_intentos` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `sesiones` (
    `id` VARCHAR(36) NOT NULL,
    `usuario_id` INTEGER NOT NULL,
    `refresh_hash` VARCHAR(64) NOT NULL,
    `refresh_hash_anterior` VARCHAR(64) NULL,
    `rotado_en` DATETIME(3) NULL,
    `recordar` BOOLEAN NOT NULL DEFAULT false,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ultimo_uso` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expira_en` DATETIME(3) NOT NULL,
    `revocada_en` DATETIME(3) NULL,

    UNIQUE INDEX `sesiones_refresh_hash_key`(`refresh_hash`),
    INDEX `sesiones_usuario_id_idx`(`usuario_id`),
    INDEX `sesiones_refresh_hash_anterior_idx`(`refresh_hash_anterior`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `eventos_seguridad` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuario_id` INTEGER NULL,
    `email` VARCHAR(191) NULL,
    `tipo` VARCHAR(64) NOT NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `detalle` TEXT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `eventos_seguridad_usuario_id_creado_en_idx`(`usuario_id`, `creado_en`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sesiones` ADD CONSTRAINT `sesiones_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `eventos_seguridad` ADD CONSTRAINT `eventos_seguridad_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

