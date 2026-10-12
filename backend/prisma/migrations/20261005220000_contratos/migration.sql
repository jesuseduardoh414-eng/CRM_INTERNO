-- CreateTable
CREATE TABLE `contratos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `folio` VARCHAR(40) NOT NULL,
    `titulo` VARCHAR(255) NOT NULL,
    `tipo` VARCHAR(20) NOT NULL,
    `categoria` VARCHAR(40) NULL,
    `estado` VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    `contraparte_nombre` VARCHAR(255) NOT NULL,
    `contraparte_rfc` VARCHAR(13) NULL,
    `contraparte_contacto` VARCHAR(255) NULL,
    `contraparte_email` VARCHAR(191) NULL,
    `contraparte_telefono` VARCHAR(40) NULL,
    `descripcion` TEXT NULL,
    `monto` DECIMAL(14, 2) NULL,
    `moneda` VARCHAR(3) NOT NULL DEFAULT 'MXN',
    `incluye_iva` BOOLEAN NOT NULL DEFAULT false,
    `periodicidad_pago` VARCHAR(20) NULL,
    `fecha_firma` DATE NULL,
    `fecha_inicio` DATE NULL,
    `fecha_fin` DATE NULL,
    `renovacion_automatica` BOOLEAN NOT NULL DEFAULT false,
    `dias_aviso` INTEGER NOT NULL DEFAULT 30,
    `notas` TEXT NULL,
    `proyecto_id` INTEGER NULL,
    `responsable_id` INTEGER NULL,
    `creado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `contratos_folio_key`(`folio`),
    INDEX `contratos_tipo_idx`(`tipo`),
    INDEX `contratos_estado_idx`(`estado`),
    INDEX `contratos_fecha_fin_idx`(`fecha_fin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contrato_archivos` (
    `id` VARCHAR(36) NOT NULL,
    `contrato_id` INTEGER NOT NULL,
    `nombre_original` VARCHAR(255) NOT NULL,
    `archivo` VARCHAR(80) NOT NULL,
    `tamano` INTEGER NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `tipo_documento` VARCHAR(20) NOT NULL DEFAULT 'FIRMADO',
    `subido_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `contrato_archivos_archivo_key`(`archivo`),
    INDEX `contrato_archivos_contrato_id_idx`(`contrato_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `contratos` ADD CONSTRAINT `contratos_proyecto_id_fkey` FOREIGN KEY (`proyecto_id`) REFERENCES `proyectos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contratos` ADD CONSTRAINT `contratos_responsable_id_fkey` FOREIGN KEY (`responsable_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contratos` ADD CONSTRAINT `contratos_creado_por_id_fkey` FOREIGN KEY (`creado_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contrato_archivos` ADD CONSTRAINT `contrato_archivos_contrato_id_fkey` FOREIGN KEY (`contrato_id`) REFERENCES `contratos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contrato_archivos` ADD CONSTRAINT `contrato_archivos_subido_por_id_fkey` FOREIGN KEY (`subido_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

