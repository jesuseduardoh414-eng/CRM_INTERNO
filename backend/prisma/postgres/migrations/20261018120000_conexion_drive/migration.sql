-- Conexion con Google Drive: la cuenta cuyo Drive guarda los archivos del CRM
-- y los respaldos diarios (una sola fila). Generada con `prisma migrate diff`;
-- al final, RLS como en 20261008120100 (Supabase).
-- CreateTable
CREATE TABLE "conexion_drive" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "cuenta" VARCHAR(191) NOT NULL,
    "refresh_token_cifrado" TEXT NOT NULL,
    "carpeta_id" VARCHAR(100),
    "estado" VARCHAR(20) NOT NULL DEFAULT 'ok',
    "ultimo_error" VARCHAR(500),
    "ultimo_respaldo_en" TIMESTAMP(3),
    "ultimo_respaldo_bytes" INTEGER,
    "conectado_por_id" INTEGER,
    "conectado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conexion_drive_pkey" PRIMARY KEY ("id")
);

-- Seguridad a nivel de fila (ver 20261008120100_seguridad_filas_supabase).
ALTER TABLE "conexion_drive" ENABLE ROW LEVEL SECURITY;
