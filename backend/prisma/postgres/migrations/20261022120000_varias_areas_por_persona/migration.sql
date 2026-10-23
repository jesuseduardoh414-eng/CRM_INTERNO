-- Una persona (y su invitacion) puede estar en varias areas: usuarios.area e
-- invitaciones.area guardan las claves separadas por coma
-- ("MARKETING,DESARROLLO"), como proyectos.area. Los valores de una sola area
-- siguen igual. Generada con `prisma migrate diff` sobre prisma/postgres/schema.prisma.
-- AlterTable
ALTER TABLE "usuarios" ALTER COLUMN "area" SET DATA TYPE VARCHAR(700);

-- AlterTable
ALTER TABLE "invitaciones" ALTER COLUMN "area" SET DATA TYPE VARCHAR(700);
