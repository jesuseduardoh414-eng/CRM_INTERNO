-- El token de las invitaciones se guarda como SHA-256 (hex), igual que el de
-- recuperacion de contraseña: quien lea la base o un respaldo no puede aceptar
-- una invitacion pendiente. Los enlaces ya enviados siguen valiendo, porque el
-- servidor compara contra el hash del token que llega. Solo datos, sin cambios
-- de esquema.
UPDATE `invitaciones` SET `token` = SHA2(`token`, 256);
