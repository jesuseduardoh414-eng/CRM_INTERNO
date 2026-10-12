-- Avisos por correo enviados; horas en dias personales; repeticion semanal en dias de la empresa.
-- AlterTable
ALTER TABLE `dias_empresa` ADD COLUMN `dias_semana` JSON NULL;

-- AlterTable
ALTER TABLE `dias_especiales` ADD COLUMN `hora_fin` VARCHAR(5) NULL,
    ADD COLUMN `hora_inicio` VARCHAR(5) NULL;

-- CreateTable
CREATE TABLE `avisos_enviados` (
    `clave` VARCHAR(191) NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `avisos_enviados_creado_en_idx`(`creado_en`),
    PRIMARY KEY (`clave`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

