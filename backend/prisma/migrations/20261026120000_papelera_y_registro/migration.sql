-- Papelera (lo borrado no se pierde: copia de la fila y archivos movidos a la
-- carpeta Papelera) y registro de actividad (quien creo, cambio o borro que).
-- Solo los ve el panel de configuracion. Tablas nuevas, nada se modifica.

-- CreateTable
CREATE TABLE `papelera` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tipo` VARCHAR(40) NOT NULL,
    `modulo` VARCHAR(40) NOT NULL,
    `entidad_id` VARCHAR(64) NULL,
    `nombre` VARCHAR(255) NOT NULL,
    `contexto` VARCHAR(255) NULL,
    `datos` JSON NOT NULL,
    `archivos` JSON NULL,
    `origen` VARCHAR(20) NOT NULL DEFAULT 'usuario',
    `borrado_por_id` INTEGER NULL,
    `borrado_por_nombre` VARCHAR(255) NULL,
    `borrado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `papelera_borrado_en_idx`(`borrado_en`),
    INDEX `papelera_modulo_borrado_en_idx`(`modulo`, `borrado_en`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `registro_actividad` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usuario_id` INTEGER NULL,
    `usuario_nombre` VARCHAR(255) NULL,
    `origen` VARCHAR(20) NOT NULL DEFAULT 'usuario',
    `accion` VARCHAR(20) NOT NULL,
    `modulo` VARCHAR(40) NOT NULL,
    `tipo` VARCHAR(40) NOT NULL,
    `entidad_id` VARCHAR(64) NULL,
    `entidad_nombre` VARCHAR(255) NULL,
    `cambios` JSON NULL,
    `ip` VARCHAR(64) NULL,

    INDEX `registro_actividad_creado_en_idx`(`creado_en`),
    INDEX `registro_actividad_usuario_id_creado_en_idx`(`usuario_id`, `creado_en`),
    INDEX `registro_actividad_modulo_creado_en_idx`(`modulo`, `creado_en`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `papelera` ADD CONSTRAINT `papelera_borrado_por_id_fkey` FOREIGN KEY (`borrado_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registro_actividad` ADD CONSTRAINT `registro_actividad_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

