-- Una persona (y su invitacion) puede estar en varias areas: usuarios.area e
-- invitaciones.area guardan las claves separadas por coma
-- ("MARKETING,DESARROLLO"), como proyectos.area. Los valores de una sola area
-- siguen igual. Generada con `prisma migrate diff`.
-- AlterTable
ALTER TABLE `usuarios` MODIFY `area` VARCHAR(700) NOT NULL;

-- AlterTable
ALTER TABLE `invitaciones` MODIFY `area` VARCHAR(700) NOT NULL;
