-- Finanzas: cotizaciones con versiones de archivo que no se reemplazan (la
-- 1 es la original). Base de conocimiento: articulos con archivos adjuntos.
-- Solo agrega tablas; no toca datos existentes.
-- CreateTable
CREATE TABLE `cotizaciones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `folio` VARCHAR(40) NOT NULL,
    `tipo` VARCHAR(20) NOT NULL,
    `titulo` VARCHAR(255) NOT NULL,
    `descripcion` TEXT NULL,
    `empresa_id` INTEGER NULL,
    `contraparte_nombre` VARCHAR(255) NULL,
    `moneda` VARCHAR(3) NOT NULL DEFAULT 'MXN',
    `fecha` DATE NOT NULL,
    `estado` VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    `creado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cotizaciones_folio_key`(`folio`),
    INDEX `cotizaciones_tipo_idx`(`tipo`),
    INDEX `cotizaciones_estado_idx`(`estado`),
    INDEX `cotizaciones_fecha_idx`(`fecha`),
    INDEX `cotizaciones_empresa_id_idx`(`empresa_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `versiones_cotizacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cotizacion_id` INTEGER NOT NULL,
    `numero` INTEGER NOT NULL,
    `monto` DECIMAL(14, 2) NULL,
    `nota` TEXT NULL,
    `nombre_original` VARCHAR(255) NOT NULL,
    `archivo` VARCHAR(80) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `tamano` INTEGER NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `subido_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `versiones_cotizacion_archivo_key`(`archivo`),
    UNIQUE INDEX `versiones_cotizacion_cotizacion_id_numero_key`(`cotizacion_id`, `numero`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `articulos_conocimiento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `titulo` VARCHAR(200) NOT NULL,
    `categoria` VARCHAR(80) NOT NULL,
    `resumen` VARCHAR(300) NULL,
    `contenido` LONGTEXT NOT NULL,
    `publicado` BOOLEAN NOT NULL DEFAULT true,
    `fijado` BOOLEAN NOT NULL DEFAULT false,
    `autor_id` INTEGER NULL,
    `editado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    INDEX `articulos_conocimiento_categoria_idx`(`categoria`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `archivos_conocimiento` (
    `id` VARCHAR(36) NOT NULL,
    `articulo_id` INTEGER NOT NULL,
    `nombre_original` VARCHAR(255) NOT NULL,
    `archivo` VARCHAR(80) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `tamano` INTEGER NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `subido_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `archivos_conocimiento_archivo_key`(`archivo`),
    INDEX `archivos_conocimiento_articulo_id_idx`(`articulo_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `cotizaciones` ADD CONSTRAINT `cotizaciones_empresa_id_fkey` FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cotizaciones` ADD CONSTRAINT `cotizaciones_creado_por_id_fkey` FOREIGN KEY (`creado_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `versiones_cotizacion` ADD CONSTRAINT `versiones_cotizacion_cotizacion_id_fkey` FOREIGN KEY (`cotizacion_id`) REFERENCES `cotizaciones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `versiones_cotizacion` ADD CONSTRAINT `versiones_cotizacion_subido_por_id_fkey` FOREIGN KEY (`subido_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos_conocimiento` ADD CONSTRAINT `articulos_conocimiento_autor_id_fkey` FOREIGN KEY (`autor_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos_conocimiento` ADD CONSTRAINT `articulos_conocimiento_editado_por_id_fkey` FOREIGN KEY (`editado_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `archivos_conocimiento` ADD CONSTRAINT `archivos_conocimiento_articulo_id_fkey` FOREIGN KEY (`articulo_id`) REFERENCES `articulos_conocimiento`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `archivos_conocimiento` ADD CONSTRAINT `archivos_conocimiento_subido_por_id_fkey` FOREIGN KEY (`subido_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

