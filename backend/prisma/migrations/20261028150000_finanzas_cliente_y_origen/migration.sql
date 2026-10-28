-- Finanzas: para que cliente es cada gasto y cotizacion (cliente_id), y de
-- que archivo de tarea o proyecto es copia cada version de cotizacion y cada
-- comprobante ("Mandar a finanzas"; sin llave foranea, como la bitacora).
-- Generada con `prisma migrate diff`.
-- AlterTable
ALTER TABLE `comprobantes_financieros` ADD COLUMN `adjunto_id` INTEGER NULL,
    ADD COLUMN `origen` VARCHAR(255) NULL,
    ADD COLUMN `origen_proyecto_id` INTEGER NULL,
    ADD COLUMN `origen_tarea_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `cotizaciones` ADD COLUMN `cliente_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `gastos` ADD COLUMN `cliente_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `versiones_cotizacion` ADD COLUMN `adjunto_id` INTEGER NULL,
    ADD COLUMN `origen` VARCHAR(255) NULL,
    ADD COLUMN `origen_proyecto_id` INTEGER NULL,
    ADD COLUMN `origen_tarea_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `comprobantes_financieros_adjunto_id_idx` ON `comprobantes_financieros`(`adjunto_id`);

-- CreateIndex
CREATE INDEX `cotizaciones_cliente_id_idx` ON `cotizaciones`(`cliente_id`);

-- CreateIndex
CREATE INDEX `gastos_cliente_id_idx` ON `gastos`(`cliente_id`);

-- CreateIndex
CREATE INDEX `versiones_cotizacion_adjunto_id_idx` ON `versiones_cotizacion`(`adjunto_id`);

-- AddForeignKey
ALTER TABLE `gastos` ADD CONSTRAINT `gastos_cliente_id_fkey` FOREIGN KEY (`cliente_id`) REFERENCES `empresas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cotizaciones` ADD CONSTRAINT `cotizaciones_cliente_id_fkey` FOREIGN KEY (`cliente_id`) REFERENCES `empresas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

