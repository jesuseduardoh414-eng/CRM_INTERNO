-- Conexion con Google Drive: la cuenta cuyo Drive guarda los archivos del CRM
-- y los respaldos diarios (una sola fila). Generada con `prisma migrate diff`.
-- CreateTable
CREATE TABLE `conexion_drive` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `cuenta` VARCHAR(191) NOT NULL,
    `refresh_token_cifrado` TEXT NOT NULL,
    `carpeta_id` VARCHAR(100) NULL,
    `estado` VARCHAR(20) NOT NULL DEFAULT 'ok',
    `ultimo_error` VARCHAR(500) NULL,
    `ultimo_respaldo_en` DATETIME(3) NULL,
    `ultimo_respaldo_bytes` INTEGER NULL,
    `conectado_por_id` INTEGER NULL,
    `conectado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
