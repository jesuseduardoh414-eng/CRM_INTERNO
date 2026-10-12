-- Horario distinto por dia de la semana (p. ej. sabado medio turno).
-- AlterTable
ALTER TABLE `calendario_laboral` ADD COLUMN `horarios_por_dia` JSON NULL;

