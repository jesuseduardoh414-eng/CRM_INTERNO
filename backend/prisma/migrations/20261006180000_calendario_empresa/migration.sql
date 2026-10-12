-- Calendario de la empresa (festivos, no laborables, cierres...).
-- CreateTable
CREATE TABLE `dias_empresa` (
    `id` VARCHAR(36) NOT NULL,
    `fecha_inicio` DATE NOT NULL,
    `fecha_fin` DATE NOT NULL,
    `tipo` VARCHAR(20) NOT NULL,
    `nombre` VARCHAR(120) NOT NULL,
    `descripcion` TEXT NULL,
    `repetir_anual` BOOLEAN NOT NULL DEFAULT false,
    `area` VARCHAR(40) NULL,
    `creado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dias_empresa_fecha_inicio_idx`(`fecha_inicio`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `dias_empresa` ADD CONSTRAINT `dias_empresa_creado_por_id_fkey` FOREIGN KEY (`creado_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

