-- Tesoreria: presupuesto mensual por categoria de gastos. Sustituye a las
-- partidas libres: las que existan se archivan y quedan como historial (sus
-- asignaciones ya no descuentan de la bolsa de ingresos).
-- CreateTable
CREATE TABLE `presupuestos_categoria` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `categoria` VARCHAR(30) NOT NULL,
    `anio` INTEGER NOT NULL,
    `mes` INTEGER NOT NULL,
    `monto` DECIMAL(14, 2) NOT NULL,
    `fijado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    INDEX `presupuestos_categoria_anio_mes_idx`(`anio`, `mes`),
    UNIQUE INDEX `presupuestos_categoria_categoria_anio_mes_key`(`categoria`, `anio`, `mes`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `presupuestos_categoria` ADD CONSTRAINT `presupuestos_categoria_fijado_por_id_fkey` FOREIGN KEY (`fijado_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Archivar las partidas existentes
UPDATE `partidas` SET `activa` = false;
