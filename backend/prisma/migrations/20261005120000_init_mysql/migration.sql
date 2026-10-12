-- CreateTable
CREATE TABLE `usuarios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(255) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `telefono` VARCHAR(191) NULL,
    `puesto` VARCHAR(255) NULL,
    `biografia` TEXT NULL,
    `foto_perfil_url` LONGTEXT NULL,
    `area` ENUM('DESARROLLO', 'ADMINISTRACION', 'COMUNICACION', 'MARKETING') NOT NULL,
    `rol` ENUM('ADMIN', 'MIEMBRO') NOT NULL DEFAULT 'MIEMBRO',
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resetToken` VARCHAR(191) NULL,
    `resetTokenExpires` DATETIME(3) NULL,
    `verificado` BOOLEAN NOT NULL DEFAULT false,
    `verificationToken` VARCHAR(191) NULL,
    `verificationTokenExpires` DATETIME(3) NULL,
    `estado` VARCHAR(191) NULL DEFAULT 'pendiente',
    `token_invitacion` VARCHAR(191) NULL,
    `token_expira_en` DATETIME(3) NULL,
    `password_hash` VARCHAR(191) NULL,
    `google_calendar_email` VARCHAR(191) NULL,
    `google_access_token` TEXT NULL,
    `google_refresh_token` TEXT NULL,
    `google_token_expires_at` DATETIME(3) NULL,

    UNIQUE INDEX `usuarios_email_key`(`email`),
    UNIQUE INDEX `usuarios_token_invitacion_key`(`token_invitacion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invitaciones` (
    `id` VARCHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(255) NOT NULL,
    `area` VARCHAR(191) NOT NULL,
    `rol` VARCHAR(191) NOT NULL DEFAULT 'miembro',
    `token` VARCHAR(191) NOT NULL,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
    `creado_por` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expira_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invitaciones_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proyectos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(255) NOT NULL,
    `descripcion` TEXT NULL,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'ACTIVO',
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `creadorId` INTEGER NOT NULL,
    `area` VARCHAR(191) NOT NULL DEFAULT 'DESARROLLO',
    `fechaFin` DATETIME(3) NULL,
    `fechaInicio` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plantillas_proyecto` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(255) NOT NULL,
    `descripcion` TEXT NULL,
    `area` VARCHAR(191) NOT NULL DEFAULT 'DESARROLLO',
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `creadorId` INTEGER NOT NULL,
    `proyectoBaseId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plantillas_tarea` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `plantillaId` INTEGER NOT NULL,
    `clave` VARCHAR(191) NOT NULL,
    `titulo` VARCHAR(255) NOT NULL,
    `descripcion` TEXT NULL,
    `prioridad` VARCHAR(191) NOT NULL DEFAULT 'MEDIA',
    `orden` INTEGER NOT NULL DEFAULT 0,
    `offsetInicioDias` INTEGER NOT NULL DEFAULT 0,
    `offsetVenceDias` INTEGER NULL,
    `dependeDeClave` VARCHAR(191) NULL,

    UNIQUE INDEX `plantillas_tarea_plantillaId_clave_key`(`plantillaId`, `clave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tareas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `titulo` VARCHAR(255) NOT NULL,
    `descripcion` TEXT NULL,
    `numeroActividad` INTEGER NULL,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'PENDIENTE',
    `prioridad` VARCHAR(191) NOT NULL DEFAULT 'MEDIA',
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completadoEn` DATETIME(3) NULL,
    `venceEn` DATETIME(3) NULL,
    `proyectoId` INTEGER NOT NULL,
    `asignadoId` INTEGER NULL,
    `creadorId` INTEGER NULL,
    `dependeDeId` INTEGER NULL,
    `fechaInicio` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tareas_asignadoId_idx`(`asignadoId`),
    INDEX `tareas_creadorId_idx`(`creadorId`),
    INDEX `tareas_estado_idx`(`estado`),
    INDEX `tareas_proyectoId_numeroActividad_idx`(`proyectoId`, `numeroActividad`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notificaciones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mensaje` TEXT NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `leida` BOOLEAN NOT NULL DEFAULT false,
    `creadaEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usuarioId` INTEGER NOT NULL,
    `tareaId` INTEGER NULL,
    `proyectoId` INTEGER NULL,
    `eventoId` VARCHAR(36) NULL,
    `actorNombre` VARCHAR(255) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comentarios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contenido` TEXT NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `autorId` INTEGER NOT NULL,
    `tareaId` INTEGER NULL,
    `proyectoId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `logs_actividad` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accion` VARCHAR(191) NOT NULL,
    `descripcion` TEXT NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usuarioId` INTEGER NOT NULL,
    `proyectoId` INTEGER NOT NULL,
    `tareaId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `adjuntos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(255) NOT NULL,
    `url` TEXT NOT NULL,
    `tipo` VARCHAR(191) NULL,
    `tamano` INTEGER NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usuarioId` INTEGER NOT NULL,
    `tareaId` INTEGER NULL,
    `proyectoId` INTEGER NULL,
    `eventoId` VARCHAR(36) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `eventos` (
    `id` VARCHAR(36) NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `titulo` VARCHAR(255) NOT NULL,
    `descripcion` TEXT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `modalidad` VARCHAR(191) NOT NULL DEFAULT 'presencial',
    `ubicacion` VARCHAR(255) NULL,
    `url_reunion` TEXT NULL,
    `instrucciones_acceso` TEXT NULL,
    `fecha_inicio` DATETIME(3) NOT NULL,
    `fecha_fin` DATETIME(3) NULL,
    `todo_el_dia` BOOLEAN NOT NULL DEFAULT false,
    `color` VARCHAR(191) NOT NULL DEFAULT '#4a90d9',
    `alerta_minutos` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `es_compartido` BOOLEAN NOT NULL DEFAULT false,
    `es_global` BOOLEAN NOT NULL DEFAULT false,
    `proyecto_id` INTEGER NULL,
    `creado_por_id` INTEGER NULL,
    `es_recurrente` BOOLEAN NOT NULL DEFAULT false,
    `patron_recurrencia` TEXT NULL,
    `fecha_fin_recurrencia` DATETIME(3) NULL,
    `google_calendar_event_id` VARCHAR(255) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evento_invitados` (
    `id` VARCHAR(36) NOT NULL,
    `evento_id` VARCHAR(36) NOT NULL,
    `usuario_id` INTEGER NOT NULL,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
    `visto` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `evento_invitados_evento_id_usuario_id_key`(`evento_id`, `usuario_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendario_laboral` (
    `id` VARCHAR(36) NOT NULL,
    `usuario_id` INTEGER NOT NULL,
    `dias_laborales` JSON NOT NULL,
    `hora_entrada` VARCHAR(191) NOT NULL DEFAULT '09:00',
    `hora_salida` VARCHAR(191) NOT NULL DEFAULT '18:00',
    `hora_comida_inicio` VARCHAR(191) NOT NULL DEFAULT '14:00',
    `hora_comida_fin` VARCHAR(191) NOT NULL DEFAULT '15:00',
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `calendario_laboral_usuario_id_key`(`usuario_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dias_especiales` (
    `id` VARCHAR(36) NOT NULL,
    `usuario_id` INTEGER NOT NULL,
    `fecha` DATE NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `descripcion` TEXT NULL,

    UNIQUE INDEX `dias_especiales_usuario_id_fecha_key`(`usuario_id`, `fecha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_ProyectoMiembro` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_ProyectoMiembro_AB_unique`(`A`, `B`),
    INDEX `_ProyectoMiembro_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_AsignadosMultiplesTarea` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_AsignadosMultiplesTarea_AB_unique`(`A`, `B`),
    INDEX `_AsignadosMultiplesTarea_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `invitaciones` ADD CONSTRAINT `invitaciones_creado_por_fkey` FOREIGN KEY (`creado_por`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proyectos` ADD CONSTRAINT `proyectos_creadorId_fkey` FOREIGN KEY (`creadorId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plantillas_proyecto` ADD CONSTRAINT `plantillas_proyecto_creadorId_fkey` FOREIGN KEY (`creadorId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plantillas_proyecto` ADD CONSTRAINT `plantillas_proyecto_proyectoBaseId_fkey` FOREIGN KEY (`proyectoBaseId`) REFERENCES `proyectos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plantillas_tarea` ADD CONSTRAINT `plantillas_tarea_plantillaId_fkey` FOREIGN KEY (`plantillaId`) REFERENCES `plantillas_proyecto`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tareas` ADD CONSTRAINT `tareas_asignadoId_fkey` FOREIGN KEY (`asignadoId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tareas` ADD CONSTRAINT `tareas_creadorId_fkey` FOREIGN KEY (`creadorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tareas` ADD CONSTRAINT `tareas_dependeDeId_fkey` FOREIGN KEY (`dependeDeId`) REFERENCES `tareas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tareas` ADD CONSTRAINT `tareas_proyectoId_fkey` FOREIGN KEY (`proyectoId`) REFERENCES `proyectos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificaciones` ADD CONSTRAINT `notificaciones_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificaciones` ADD CONSTRAINT `notificaciones_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `tareas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificaciones` ADD CONSTRAINT `notificaciones_proyectoId_fkey` FOREIGN KEY (`proyectoId`) REFERENCES `proyectos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificaciones` ADD CONSTRAINT `notificaciones_eventoId_fkey` FOREIGN KEY (`eventoId`) REFERENCES `eventos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comentarios` ADD CONSTRAINT `comentarios_autorId_fkey` FOREIGN KEY (`autorId`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comentarios` ADD CONSTRAINT `comentarios_proyectoId_fkey` FOREIGN KEY (`proyectoId`) REFERENCES `proyectos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comentarios` ADD CONSTRAINT `comentarios_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `tareas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `logs_actividad` ADD CONSTRAINT `logs_actividad_proyectoId_fkey` FOREIGN KEY (`proyectoId`) REFERENCES `proyectos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `logs_actividad` ADD CONSTRAINT `logs_actividad_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `tareas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `logs_actividad` ADD CONSTRAINT `logs_actividad_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `adjuntos` ADD CONSTRAINT `adjuntos_proyectoId_fkey` FOREIGN KEY (`proyectoId`) REFERENCES `proyectos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `adjuntos` ADD CONSTRAINT `adjuntos_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `tareas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `adjuntos` ADD CONSTRAINT `adjuntos_eventoId_fkey` FOREIGN KEY (`eventoId`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `adjuntos` ADD CONSTRAINT `adjuntos_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `eventos` ADD CONSTRAINT `eventos_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `eventos` ADD CONSTRAINT `eventos_proyecto_id_fkey` FOREIGN KEY (`proyecto_id`) REFERENCES `proyectos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `eventos` ADD CONSTRAINT `eventos_creado_por_id_fkey` FOREIGN KEY (`creado_por_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evento_invitados` ADD CONSTRAINT `evento_invitados_evento_id_fkey` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evento_invitados` ADD CONSTRAINT `evento_invitados_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendario_laboral` ADD CONSTRAINT `calendario_laboral_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dias_especiales` ADD CONSTRAINT `dias_especiales_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ProyectoMiembro` ADD CONSTRAINT `_ProyectoMiembro_A_fkey` FOREIGN KEY (`A`) REFERENCES `proyectos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ProyectoMiembro` ADD CONSTRAINT `_ProyectoMiembro_B_fkey` FOREIGN KEY (`B`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_AsignadosMultiplesTarea` ADD CONSTRAINT `_AsignadosMultiplesTarea_A_fkey` FOREIGN KEY (`A`) REFERENCES `tareas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_AsignadosMultiplesTarea` ADD CONSTRAINT `_AsignadosMultiplesTarea_B_fkey` FOREIGN KEY (`B`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

