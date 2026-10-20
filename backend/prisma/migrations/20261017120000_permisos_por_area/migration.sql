-- Permisos por area (panel de configuracion) y ajustes por persona: columna
-- usuarios.permisos. Las tablas por area viven en la configuracion (JSON).
-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `permisos` JSON NULL;

