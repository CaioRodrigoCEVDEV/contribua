# Contribua — Gerenciamento de contribuições (multi-tenant)

Plataforma onde cada usuário cadastrado cria as suas **listas de contribuição**
(vaquinhas), acompanha quem já pagou em um **painel** e compartilha um **link público**
para o grupo marcar as parcelas — tudo com os dados salvos no servidor
(sem depender do `localStorage` do navegador).

## Stack

- **Node.js + Express** (API REST + serve o front estático)
- **PostgreSQL** (persistência)
- **Autenticação** por e-mail + senha (hash com bcrypt, sessão via JWT em cookie httpOnly)
- Front-end em HTML/CSS/JS puro (sem build)

## Estrutura

```
espaco_mirante_plataforma/
  docker-compose.yml        # PostgreSQL SOMENTE para testes locais
  .env.example              # modelo de configuração
  deploy.sh                 # script de deploy (usado pelo GitHub Actions)
  ecosystem.config.cjs      # configuração do PM2
  DEPLOY.md                 # guia de deploy (PM2 + banco externo)
  .github/workflows/
    deploy.yml              # workflow de deploy via SSH
  src/
    server.js               # app Express, rotas de páginas e estáticos
    db.js                   # pool de conexões do Postgres
    schema.sql              # schema (users, payment_tables, participants)
    migrate.js              # aplica o schema (npm run migrate)
    auth.js                 # JWT, cookie de sessão, middleware requireAuth
    slug.js                 # geração de slug único para o link público
    routes/
      auth.js               # /api/auth  (register, login, logout, me)
      tables.js             # /api/tables (CRUD + participantes) — requer login
      public.js             # /api/public (link compartilhado + toggle)
  public/
    index.html / index.js   # landing com login e cadastro
    dashboard.html / .js    # painel: criar, gerenciar e compartilhar tabelas
    poster.html / poster.js # página pública /t/:slug
    poster.css              # visual da página pública (com captura em imagem)
    platform.css            # estilo da landing e do painel
    common.js               # helpers (fetch, toast, moeda, escape)
    vendor/html2canvas.min.js
```

> Deploy em produção (PM2 + Postgres externo + GitHub Actions): veja **[DEPLOY.md](DEPLOY.md)**.

## Como rodar

Pré-requisitos: Node.js 18+ e Docker (ou um Postgres próprio).

```bash
# 1. Configuração
cp .env.example .env
# edite DATABASE_URL e JWT_SECRET se necessário

# 2. Banco de dados (usa a porta 5432 por padrão; aqui usamos 5433 no dev)
POSTGRES_PORT=5433 docker compose up -d

# 3. Dependências
npm install

# 4. Schema
npm run migrate

# 5. Servidor
npm start        # produção
npm run dev      # desenvolvimento (reinicia ao salvar)
```

Acesse **http://localhost:3000**.

> No `.env` de exemplo a `DATABASE_URL` usa `localhost:5432`. Se subir o container
> em outra porta (como `5433`), ajuste a `DATABASE_URL` para bater.

## Rotas de páginas

| Rota         | Descrição                                              |
|--------------|--------------------------------------------------------|
| `/`          | Landing com login/cadastro                            |
| `/dashboard` | Painel do usuário (exige login; redireciona se anônimo)|
| `/t/:slug`   | Página pública compartilhável de uma tabela           |

## API

### Autenticação (`/api/auth`)
| Método | Rota        | Descrição                          |
|--------|-------------|------------------------------------|
| POST   | `/register` | `{ name, email, password }`        |
| POST   | `/login`    | `{ email, password }`              |
| POST   | `/logout`   | Encerra a sessão                   |
| GET    | `/me`       | Usuário autenticado                |

### Tabelas (`/api/tables`) — requer login
| Método | Rota                              | Descrição                                  |
|--------|-----------------------------------|--------------------------------------------|
| GET    | `/`                               | Lista as tabelas do usuário (com contagens)|
| POST   | `/`                               | Cria tabela (campos + `participants[]`)    |
| GET    | `/:id`                            | Detalhe + participantes                    |
| PUT    | `/:id`                            | Atualiza os dados da tabela                |
| DELETE | `/:id`                            | Exclui a tabela                            |
| POST   | `/:id/participants`               | Adiciona participante `{ name }`           |
| PUT    | `/:id/participants/:pid`          | Atualiza `{ name, paid, note }`            |
| DELETE | `/:id/participants/:pid`          | Remove participante                        |

### Público (`/api/public`) — sem login
| Método | Rota              | Descrição                                             |
|--------|-------------------|-------------------------------------------------------|
| GET    | `/:slug`          | Dados da tabela compartilhada + resumo + participantes|
| POST   | `/:slug/toggle`   | `{ participantId }` alterna pago/pendente (se liberado)|

### Configurações e integrações — requer login
| Método | Rota                          | Descrição                                                   |
|--------|-------------------------------|-------------------------------------------------------------|
| GET    | `/api/settings`               | Configurações de IA e estado da integração com o CRM        |
| PUT    | `/api/settings`               | Salva IA e integração com o CRM (segredo criptografado)     |
| POST   | `/api/integrations/crm/send`  | `{ message, image_url?, idempotency_key? }` envia ao CRM    |

A integração com o CRM usa a URL completa de execução fornecida pelo CRM
(`.../api/integrations/webhooks/:id/execute`). O backend valida a URL, envia o
segredo em `Authorization: Bearer`, usa `Idempotency-Key` e repassa
`{ "message": "...", "imageUrl": "..." }` quando há imagem. O `imageUrl` usa a
imagem pública da tabela (`/t/:slug/og-image`) e é validado contra hosts
privados/locais antes do envio.

## Multi-tenant

- Cada `payment_table` pertence a um `user` (`user_id`). As rotas de `/api/tables`
  filtram sempre por `user_id`, garantindo isolamento entre contas.
- O link público usa um `slug` único e aleatório (ex.: `vaquinha-aniversario-70hx9`).
- A edição pelo link público é opcional, controlada por `allow_public_edit`.

## Segurança

- Senhas com hash **bcrypt**; nunca são retornadas pela API.
- Sessão em **cookie httpOnly** (JWT, 7 dias). Em `NODE_ENV=production` o cookie é `secure`.
- Consultas sempre parametrizadas (`pg`), evitando SQL injection.
- Segredos de IA e do CRM são criptografados em repouso (AES-256-GCM) e nunca voltam ao navegador.
- A URL do CRM é validada no cadastro e no envio, com HTTPS obrigatório em produção e bloqueio de hosts locais/privados.
- **Importante:** troque o `JWT_SECRET` em produção.

## Próximos passos sugeridos

- Recuperação de senha por e-mail e verificação de conta.
- Limite de tentativas de login (rate limiting) e `helmet`.
- Imagem/identidade personalizada por tabela.
- Convite de colaboradores com permissões por tabela.
- Deploy (ex.: Render/Railway + Postgres gerenciado) e HTTPS.
