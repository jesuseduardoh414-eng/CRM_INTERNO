-- Las areas ahora se definen en el panel de configuracion (reglas.areas).
ALTER TABLE `usuarios` MODIFY `area` VARCHAR(40) NOT NULL;
