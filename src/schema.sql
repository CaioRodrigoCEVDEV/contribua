-- Schema da plataforma Contribua
-- Cada usuário (tenant) é dono de várias "tabelas" de contribuição.
-- Os participantes pertencem a uma tabela.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  openai_key      text NOT NULL DEFAULT '',
  openai_model    text NOT NULL DEFAULT '',
  openai_base_url text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_tables (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug               text NOT NULL UNIQUE,
  title              text NOT NULL,
  subtitle           text NOT NULL DEFAULT '',
  installment_label  text NOT NULL DEFAULT '1ª PARCELA',
  installment_due    text NOT NULL DEFAULT '',
  installment_cents  integer NOT NULL DEFAULT 5000,
  total_goal_cents   integer NOT NULL DEFAULT 0,
  pix_name           text NOT NULL DEFAULT '',
  pix_key            text NOT NULL DEFAULT '',
  header_image       text NOT NULL DEFAULT '',
  allow_public_edit  boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS participants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id   uuid NOT NULL REFERENCES payment_tables(id) ON DELETE CASCADE,
  name       text NOT NULL,
  paid       boolean NOT NULL DEFAULT false,
  note       text NOT NULL DEFAULT '',
  position   integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS participants_table_idx ON participants (table_id, position);
CREATE INDEX IF NOT EXISTS payment_tables_user_idx ON payment_tables (user_id, created_at DESC);

-- Garante a coluna updated_at em bancos criados antes desta versão.
ALTER TABLE payment_tables ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Imagem exibida no cabeçalho público (data URL). Bancos antigos ganham a coluna.
ALTER TABLE payment_tables ADD COLUMN IF NOT EXISTS header_image text NOT NULL DEFAULT '';

-- Configuração de IA por tenant (chave criptografada em repouso).
ALTER TABLE users ADD COLUMN IF NOT EXISTS openai_key text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS openai_model text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS openai_base_url text NOT NULL DEFAULT '';

-- Integração com o CRM (endpoint completo do webhook + segredo criptografado em repouso).
ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_endpoint_url text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_secret text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_send_image boolean NOT NULL DEFAULT true;

-- Local do evento (endereço + link do Google Maps) e galeria de fotos do local.
ALTER TABLE payment_tables ADD COLUMN IF NOT EXISTS location_address text NOT NULL DEFAULT '';
ALTER TABLE payment_tables ADD COLUMN IF NOT EXISTS location_url text NOT NULL DEFAULT '';

-- Contador de visitas da página pública.
ALTER TABLE payment_tables ADD COLUMN IF NOT EXISTS visits integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS table_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id   uuid NOT NULL REFERENCES payment_tables(id) ON DELETE CASCADE,
  image      text NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS table_images_idx ON table_images (table_id, position);

-- Renomeia a coluna antiga (bancos já criados antes do rebrand para "Contribua").
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'payment_tables' AND column_name = 'rental_total_cents'
  ) THEN
    ALTER TABLE payment_tables RENAME COLUMN rental_total_cents TO total_goal_cents;
  END IF;
END $$;
