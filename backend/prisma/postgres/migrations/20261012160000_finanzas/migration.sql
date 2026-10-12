-- Finanzas: Ventas (pagos), Tesoreria (partidas y asignaciones), Gastos,
-- comprobantes en disco y bitacora propia. Solo agrega: una columna JSONB en
-- usuarios (permisos_finanzas) y siete tablas nuevas; no toca datos existentes.
-- Generada con `prisma migrate diff` entre prisma/postgres/schema.prisma del
-- commit anterior y el nuevo; al final, RLS como en 20261008120100 (Supabase).

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "permisos_finanzas" JSONB;

-- CreateTable
CREATE TABLE "cuentas_financieras" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'BANCO',
    "banco" VARCHAR(80),
    "referencia" VARCHAR(40),
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cuentas_financieras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partidas" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "color" VARCHAR(9),
    "descripcion" VARCHAR(255),
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partidas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asignaciones_partida" (
    "id" SERIAL NOT NULL,
    "partida_id" INTEGER NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "fecha" DATE NOT NULL,
    "nota" VARCHAR(255),
    "creado_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asignaciones_partida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "id" SERIAL NOT NULL,
    "folio" VARCHAR(40) NOT NULL,
    "concepto" VARCHAR(255) NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "moneda" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "fecha" DATE NOT NULL,
    "metodo" VARCHAR(20) NOT NULL DEFAULT 'TRANSFERENCIA',
    "referencia" VARCHAR(80),
    "origen" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "estado" VARCHAR(20) NOT NULL DEFAULT 'REGISTRADO',
    "motivo_anulacion" VARCHAR(255),
    "notas" TEXT,
    "empresa_id" INTEGER,
    "cliente_nombre" VARCHAR(255),
    "cuenta_id" INTEGER,
    "contrato_id" INTEGER,
    "proyecto_id" INTEGER,
    "creado_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gastos" (
    "id" SERIAL NOT NULL,
    "folio" VARCHAR(40) NOT NULL,
    "categoria" VARCHAR(30) NOT NULL,
    "concepto" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "monto" DECIMAL(14,2) NOT NULL,
    "moneda" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "fecha" DATE NOT NULL,
    "fecha_limite" DATE,
    "pagado_en" DATE,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "metodo" VARCHAR(20),
    "referencia" VARCHAR(80),
    "motivo_anulacion" VARCHAR(255),
    "notas" TEXT,
    "partida_id" INTEGER,
    "empresa_id" INTEGER,
    "proveedor_nombre" VARCHAR(255),
    "cuenta_id" INTEGER,
    "creado_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gastos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobantes_financieros" (
    "id" VARCHAR(36) NOT NULL,
    "pago_id" INTEGER,
    "gasto_id" INTEGER,
    "nombre_original" VARCHAR(255) NOT NULL,
    "archivo" VARCHAR(80) NOT NULL,
    "mime" VARCHAR(60) NOT NULL,
    "tamano" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "subido_por_id" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comprobantes_financieros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs_finanzas" (
    "id" SERIAL NOT NULL,
    "entidad" VARCHAR(20) NOT NULL,
    "entidad_id" INTEGER NOT NULL,
    "accion" VARCHAR(30) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "usuario_id" INTEGER,
    "usuario_nombre" VARCHAR(255),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_finanzas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asignaciones_partida_partida_id_idx" ON "asignaciones_partida"("partida_id");

-- CreateIndex
CREATE INDEX "asignaciones_partida_fecha_idx" ON "asignaciones_partida"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_folio_key" ON "pagos"("folio");

-- CreateIndex
CREATE INDEX "pagos_fecha_idx" ON "pagos"("fecha");

-- CreateIndex
CREATE INDEX "pagos_estado_idx" ON "pagos"("estado");

-- CreateIndex
CREATE INDEX "pagos_empresa_id_idx" ON "pagos"("empresa_id");

-- CreateIndex
CREATE INDEX "pagos_cuenta_id_idx" ON "pagos"("cuenta_id");

-- CreateIndex
CREATE UNIQUE INDEX "gastos_folio_key" ON "gastos"("folio");

-- CreateIndex
CREATE INDEX "gastos_categoria_idx" ON "gastos"("categoria");

-- CreateIndex
CREATE INDEX "gastos_fecha_idx" ON "gastos"("fecha");

-- CreateIndex
CREATE INDEX "gastos_fecha_limite_idx" ON "gastos"("fecha_limite");

-- CreateIndex
CREATE INDEX "gastos_estado_idx" ON "gastos"("estado");

-- CreateIndex
CREATE INDEX "gastos_partida_id_idx" ON "gastos"("partida_id");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_financieros_archivo_key" ON "comprobantes_financieros"("archivo");

-- CreateIndex
CREATE INDEX "comprobantes_financieros_pago_id_idx" ON "comprobantes_financieros"("pago_id");

-- CreateIndex
CREATE INDEX "comprobantes_financieros_gasto_id_idx" ON "comprobantes_financieros"("gasto_id");

-- CreateIndex
CREATE INDEX "logs_finanzas_entidad_entidad_id_idx" ON "logs_finanzas"("entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "logs_finanzas_creado_en_idx" ON "logs_finanzas"("creado_en");

-- AddForeignKey
ALTER TABLE "asignaciones_partida" ADD CONSTRAINT "asignaciones_partida_partida_id_fkey" FOREIGN KEY ("partida_id") REFERENCES "partidas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_partida" ADD CONSTRAINT "asignaciones_partida_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuentas_financieras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_partida_id_fkey" FOREIGN KEY ("partida_id") REFERENCES "partidas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuentas_financieras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes_financieros" ADD CONSTRAINT "comprobantes_financieros_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pagos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes_financieros" ADD CONSTRAINT "comprobantes_financieros_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes_financieros" ADD CONSTRAINT "comprobantes_financieros_subido_por_id_fkey" FOREIGN KEY ("subido_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seguridad a nivel de fila (ver 20261008120100_seguridad_filas_supabase).
ALTER TABLE "cuentas_financieras" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partidas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asignaciones_partida" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pagos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gastos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comprobantes_financieros" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logs_finanzas" ENABLE ROW LEVEL SECURITY;
