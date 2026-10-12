-- Finanzas: Ventas (pagos), Tesoreria (partidas y asignaciones), Gastos,
-- comprobantes en disco y bitacora propia. Solo agrega: una columna JSON en
-- usuarios (permisos_finanzas) y siete tablas nuevas; no toca datos existentes.

-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `permisos_finanzas` JSON NULL;

-- CreateTable
CREATE TABLE `cuentas_financieras` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(120) NOT NULL,
    `tipo` VARCHAR(20) NOT NULL DEFAULT 'BANCO',
    `banco` VARCHAR(80) NULL,
    `referencia` VARCHAR(40) NULL,
    `activa` BOOLEAN NOT NULL DEFAULT true,
    `orden` INTEGER NOT NULL DEFAULT 0,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `partidas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(80) NOT NULL,
    `color` VARCHAR(9) NULL,
    `descripcion` VARCHAR(255) NULL,
    `activa` BOOLEAN NOT NULL DEFAULT true,
    `orden` INTEGER NOT NULL DEFAULT 0,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asignaciones_partida` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `partida_id` INTEGER NOT NULL,
    `monto` DECIMAL(14, 2) NOT NULL,
    `fecha` DATE NOT NULL,
    `nota` VARCHAR(255) NULL,
    `creado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `asignaciones_partida_partida_id_idx`(`partida_id`),
    INDEX `asignaciones_partida_fecha_idx`(`fecha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pagos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `folio` VARCHAR(40) NOT NULL,
    `concepto` VARCHAR(255) NOT NULL,
    `monto` DECIMAL(14, 2) NOT NULL,
    `moneda` VARCHAR(3) NOT NULL DEFAULT 'MXN',
    `fecha` DATE NOT NULL,
    `metodo` VARCHAR(20) NOT NULL DEFAULT 'TRANSFERENCIA',
    `referencia` VARCHAR(80) NULL,
    `origen` VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    `estado` VARCHAR(20) NOT NULL DEFAULT 'REGISTRADO',
    `motivo_anulacion` VARCHAR(255) NULL,
    `notas` TEXT NULL,
    `empresa_id` INTEGER NULL,
    `cliente_nombre` VARCHAR(255) NULL,
    `cuenta_id` INTEGER NULL,
    `contrato_id` INTEGER NULL,
    `proyecto_id` INTEGER NULL,
    `creado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pagos_folio_key`(`folio`),
    INDEX `pagos_fecha_idx`(`fecha`),
    INDEX `pagos_estado_idx`(`estado`),
    INDEX `pagos_empresa_id_idx`(`empresa_id`),
    INDEX `pagos_cuenta_id_idx`(`cuenta_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gastos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `folio` VARCHAR(40) NOT NULL,
    `categoria` VARCHAR(30) NOT NULL,
    `concepto` VARCHAR(255) NOT NULL,
    `descripcion` TEXT NULL,
    `monto` DECIMAL(14, 2) NOT NULL,
    `moneda` VARCHAR(3) NOT NULL DEFAULT 'MXN',
    `fecha` DATE NOT NULL,
    `fecha_limite` DATE NULL,
    `pagado_en` DATE NULL,
    `estado` VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    `metodo` VARCHAR(20) NULL,
    `referencia` VARCHAR(80) NULL,
    `motivo_anulacion` VARCHAR(255) NULL,
    `notas` TEXT NULL,
    `partida_id` INTEGER NULL,
    `empresa_id` INTEGER NULL,
    `proveedor_nombre` VARCHAR(255) NULL,
    `cuenta_id` INTEGER NULL,
    `creado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `gastos_folio_key`(`folio`),
    INDEX `gastos_categoria_idx`(`categoria`),
    INDEX `gastos_fecha_idx`(`fecha`),
    INDEX `gastos_fecha_limite_idx`(`fecha_limite`),
    INDEX `gastos_estado_idx`(`estado`),
    INDEX `gastos_partida_id_idx`(`partida_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comprobantes_financieros` (
    `id` VARCHAR(36) NOT NULL,
    `pago_id` INTEGER NULL,
    `gasto_id` INTEGER NULL,
    `nombre_original` VARCHAR(255) NOT NULL,
    `archivo` VARCHAR(80) NOT NULL,
    `mime` VARCHAR(60) NOT NULL,
    `tamano` INTEGER NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `subido_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `comprobantes_financieros_archivo_key`(`archivo`),
    INDEX `comprobantes_financieros_pago_id_idx`(`pago_id`),
    INDEX `comprobantes_financieros_gasto_id_idx`(`gasto_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `logs_finanzas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entidad` VARCHAR(20) NOT NULL,
    `entidad_id` INTEGER NOT NULL,
    `accion` VARCHAR(30) NOT NULL,
    `descripcion` TEXT NOT NULL,
    `usuario_id` INTEGER NULL,
    `usuario_nombre` VARCHAR(255) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `logs_finanzas_entidad_entidad_id_idx`(`entidad`, `entidad_id`),
    INDEX `logs_finanzas_creado_en_idx`(`creado_en`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `asignaciones_partida` ADD CONSTRAINT `asignaciones_partida_partida_id_fkey` FOREIGN KEY (`partida_id`) REFERENCES `partidas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asignaciones_partida` ADD CONSTRAINT `asignaciones_partida_creado_por_id_fkey` FOREIGN KEY (`creado_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pagos` ADD CONSTRAINT `pagos_empresa_id_fkey` FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pagos` ADD CONSTRAINT `pagos_cuenta_id_fkey` FOREIGN KEY (`cuenta_id`) REFERENCES `cuentas_financieras`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pagos` ADD CONSTRAINT `pagos_contrato_id_fkey` FOREIGN KEY (`contrato_id`) REFERENCES `contratos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pagos` ADD CONSTRAINT `pagos_proyecto_id_fkey` FOREIGN KEY (`proyecto_id`) REFERENCES `proyectos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pagos` ADD CONSTRAINT `pagos_creado_por_id_fkey` FOREIGN KEY (`creado_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gastos` ADD CONSTRAINT `gastos_partida_id_fkey` FOREIGN KEY (`partida_id`) REFERENCES `partidas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gastos` ADD CONSTRAINT `gastos_empresa_id_fkey` FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gastos` ADD CONSTRAINT `gastos_cuenta_id_fkey` FOREIGN KEY (`cuenta_id`) REFERENCES `cuentas_financieras`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gastos` ADD CONSTRAINT `gastos_creado_por_id_fkey` FOREIGN KEY (`creado_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comprobantes_financieros` ADD CONSTRAINT `comprobantes_financieros_pago_id_fkey` FOREIGN KEY (`pago_id`) REFERENCES `pagos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comprobantes_financieros` ADD CONSTRAINT `comprobantes_financieros_gasto_id_fkey` FOREIGN KEY (`gasto_id`) REFERENCES `gastos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comprobantes_financieros` ADD CONSTRAINT `comprobantes_financieros_subido_por_id_fkey` FOREIGN KEY (`subido_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
