-- Directorio de clientes y proveedores; proyectos ligados a un cliente.
-- AlterTable
ALTER TABLE `contratos` ADD COLUMN `empresa_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `proyectos` ADD COLUMN `cliente_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `empresas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(255) NOT NULL,
    `nombre_comercial` VARCHAR(255) NULL,
    `tipo` VARCHAR(20) NOT NULL DEFAULT 'CLIENTE',
    `estado` VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    `rfc` VARCHAR(13) NULL,
    `sector` VARCHAR(80) NULL,
    `sitio_web` VARCHAR(255) NULL,
    `email` VARCHAR(191) NULL,
    `telefono` VARCHAR(40) NULL,
    `direccion` VARCHAR(500) NULL,
    `ciudad` VARCHAR(120) NULL,
    `notas` TEXT NULL,
    `creado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    INDEX `empresas_tipo_idx`(`tipo`),
    INDEX `empresas_nombre_idx`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contactos_empresa` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresa_id` INTEGER NOT NULL,
    `nombre` VARCHAR(255) NOT NULL,
    `puesto` VARCHAR(120) NULL,
    `email` VARCHAR(191) NULL,
    `telefono` VARCHAR(40) NULL,
    `principal` BOOLEAN NOT NULL DEFAULT false,
    `notas` TEXT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contactos_empresa_empresa_id_idx`(`empresa_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `contratos_empresa_id_idx` ON `contratos`(`empresa_id`);

-- CreateIndex
CREATE INDEX `proyectos_cliente_id_idx` ON `proyectos`(`cliente_id`);

-- AddForeignKey
ALTER TABLE `contratos` ADD CONSTRAINT `contratos_empresa_id_fkey` FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `empresas` ADD CONSTRAINT `empresas_creado_por_id_fkey` FOREIGN KEY (`creado_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contactos_empresa` ADD CONSTRAINT `contactos_empresa_empresa_id_fkey` FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proyectos` ADD CONSTRAINT `proyectos_cliente_id_fkey` FOREIGN KEY (`cliente_id`) REFERENCES `empresas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Datos: cada contraparte de los contratos existentes pasa a ser una ficha
-- del directorio (una por nombre, sin distinguir mayúsculas ni espacios).
-- Si la misma empresa aparece como cliente y como proveedor queda en AMBOS.
INSERT INTO `empresas` (`nombre`, `tipo`, `rfc`, `email`, `telefono`, `actualizado_en`)
SELECT MIN(TRIM(`contraparte_nombre`)),
       CASE WHEN COUNT(DISTINCT `tipo`) > 1 THEN 'AMBOS' ELSE MIN(`tipo`) END,
       MAX(`contraparte_rfc`), MAX(`contraparte_email`), MAX(`contraparte_telefono`), CURRENT_TIMESTAMP(3)
FROM `contratos`
GROUP BY LOWER(TRIM(`contraparte_nombre`));

UPDATE `contratos` c
JOIN `empresas` e ON LOWER(TRIM(e.`nombre`)) = LOWER(TRIM(c.`contraparte_nombre`))
SET c.`empresa_id` = e.`id`;

-- El contacto de cada contrato pasa a contacto de la empresa (sin repetir).
INSERT INTO `contactos_empresa` (`empresa_id`, `nombre`, `email`, `telefono`, `principal`)
SELECT c.`empresa_id`, TRIM(c.`contraparte_contacto`), MAX(c.`contraparte_email`), MAX(c.`contraparte_telefono`), false
FROM `contratos` c
WHERE c.`empresa_id` IS NOT NULL AND c.`contraparte_contacto` IS NOT NULL AND TRIM(c.`contraparte_contacto`) <> ''
GROUP BY c.`empresa_id`, TRIM(c.`contraparte_contacto`);
