-- Portal de clientes: rol CLIENTE ligado a una empresa, documentos y reuniones
-- visibles para el cliente y conversación cliente-equipo por proyecto.
-- AlterTable
ALTER TABLE `adjuntos` ADD COLUMN `visible_cliente` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `eventos` ADD COLUMN `empresa_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `invitaciones` ADD COLUMN `empresa_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `empresa_id` INTEGER NULL,
    MODIFY `rol` ENUM('ADMIN', 'MIEMBRO', 'CONFIGURADOR', 'CLIENTE') NOT NULL DEFAULT 'MIEMBRO';

-- CreateTable
CREATE TABLE `mensajes_portal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `proyecto_id` INTEGER NOT NULL,
    `autor_id` INTEGER NOT NULL,
    `contenido` TEXT NOT NULL,
    `de_cliente` BOOLEAN NOT NULL DEFAULT false,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mensajes_portal_proyecto_id_creado_en_idx`(`proyecto_id`, `creado_en`),
    INDEX `mensajes_portal_autor_id_idx`(`autor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `eventos_empresa_id_idx` ON `eventos`(`empresa_id`);

-- CreateIndex
CREATE INDEX `invitaciones_empresa_id_idx` ON `invitaciones`(`empresa_id`);

-- CreateIndex
CREATE INDEX `usuarios_empresa_id_idx` ON `usuarios`(`empresa_id`);

-- AddForeignKey
ALTER TABLE `usuarios` ADD CONSTRAINT `usuarios_empresa_id_fkey` FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitaciones` ADD CONSTRAINT `invitaciones_empresa_id_fkey` FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `eventos` ADD CONSTRAINT `eventos_empresa_id_fkey` FOREIGN KEY (`empresa_id`) REFERENCES `empresas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mensajes_portal` ADD CONSTRAINT `mensajes_portal_proyecto_id_fkey` FOREIGN KEY (`proyecto_id`) REFERENCES `proyectos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mensajes_portal` ADD CONSTRAINT `mensajes_portal_autor_id_fkey` FOREIGN KEY (`autor_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

