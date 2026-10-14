# Deploy do Contribua

Guia para colocar a aplicação em produção usando **PM2**, com o **PostgreSQL fora do
docker-compose** (servidor/instância própria). O `docker-compose.yml` fica apenas como
**base de testes** local.

Arquivos envolvidos:

| Arquivo | Papel |
|---------|-------|
| `deploy.sh` | Script de deploy executado no servidor (git pull, dependências, migração, PM2). |
| `ecosystem.config.cjs` | Configuração do processo no PM2. |
| `.github/workflows/deploy.yml` | Workflow do GitHub Actions que chama o `deploy.sh` por SSH. |
| `docker-compose.yml` | Só para desenvolvimento/testes. **Não** é usado em produção. |

---

## 1. Pré-requisitos no servidor

- **Node.js 20+** (recomendado via [nvm](https://github.com/nvm-sh/nvm)).
- **PM2** global: `npm install -g pm2`
- **PostgreSQL** acessível (local ou gerenciado). O banco **não** é criado pelo docker-compose.
- **Git** e acesso de leitura ao repositório.
- (Opcional) **Nginx** como proxy reverso e HTTPS.
- Usuário SSH com acesso ao diretório da aplicação.

## 2. Banco de dados (fora do docker)

Crie o banco e um usuário no seu Postgres:

```sql
CREATE USER contribua WITH PASSWORD 'uma-senha-forte';
CREATE DATABASE contribua OWNER contribua;
```

A `DATABASE_URL` ficará assim (exemplo):

```
postgres://contribua:uma-senha-forte@127.0.0.1:5432/contribua
```

> O schema (tabelas) é criado pelo próprio deploy com `npm run migrate`.

## 3. Primeira instalação (manual)

```bash
# 1. Clonar o projeto
git clone <URL_DO_REPOSITORIO> contribua
cd contribua

# 2. Criar o .env de produção (NÃO versionar)
cp .env.example .env
nano .env
```

Conteúdo do `.env` em produção:

```env
PORT=3000
DATABASE_URL=postgres://contribua:uma-senha-forte@127.0.0.1:5432/contribua
JWT_SECRET=um-segredo-bem-grande-e-aleatorio
NODE_ENV=production
```

```bash
# 3. Dependências + schema
npm ci --omit=dev
npm run migrate

# 4. Subir com PM2
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save

# 5. Iniciar o PM2 junto com o servidor
pm2 startup            # siga a instrução exibida
pm2 save
```

A aplicação sobe em `http://localhost:3000`.

> ⚠️ **Importante:** com `NODE_ENV=production` o cookie de sessão é `secure`, ou seja,
> **só funciona via HTTPS**. Para testes rápidos sem TLS, use `NODE_ENV=development`
> ou publique por trás de um proxy HTTPS (recomendado).

## 4. Nginx (opcional, recomendado) + HTTPS

```nginx
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Depois gere o certificado com o Certbot:

```bash
sudo certbot --nginx -d seu-dominio.com
```

## 5. Deploy automático (GitHub Actions)

O workflow `.github/workflows/deploy.yml` roda a cada `push` na branch `main`
(e também pelo botão **Run workflow**). Ele entra por SSH no servidor e executa o
`deploy.sh`.

Cadastre os **secrets** em *GitHub → Settings → Secrets and variables → Actions*:

| Secret | Descrição | Exemplo |
|--------|-----------|---------|
| `SSH_HOST` | IP/host do servidor | `203.0.113.10` |
| `SSH_USER` | Usuário SSH | `deploy` |
| `SSH_KEY` | Chave privada SSH (conteúdo completo) | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `SSH_PORT` | Porta SSH (opcional, padrão 22) | `22` |
| `APP_DIR` | Caminho da aplicação no servidor | `/home/deploy/contribua` |

Para a chave: gere um par dedicado (`ssh-keygen -t ed25519`) e adicione a chave
**pública** ao `~/.ssh/authorized_keys` do usuário no servidor.

### O que o `deploy.sh` faz

1. `git fetch` + `git reset --hard origin/main` (publica exatamente o que está no repositório).
2. `npm ci --omit=dev` (instala dependências de produção).
3. `npm run migrate` (aplica o schema no Postgres externo).
4. `pm2 startOrReload ecosystem.config.cjs --env production` + `pm2 save`.

## 6. docker-compose (apenas testes)

Para testar localmente sem instalar Postgres:

```bash
POSTGRES_PORT=5433 docker compose up -d      # sobe um Postgres de teste
# no .env: DATABASE_URL=postgres://postgres:postgres@localhost:5433/contribua
npm install
npm run migrate
npm run dev
```

Para derrubar: `docker compose down` (os dados ficam no volume `espaco_mirante_pgdata`).

> Em produção **não** use este compose: aponte a `DATABASE_URL` para o seu Postgres real.

## 7. Comandos úteis (PM2)

```bash
pm2 status                 # lista os processos
pm2 logs contribua         # logs em tempo real
pm2 restart contribua      # reinicia
pm2 reload contribua       # recarga sem downtime
pm2 stop contribua         # para
pm2 delete contribua       # remove do PM2
pm2 monit                  # monitor de CPU/memória
```

## 8. Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta do servidor Express (padrão 3000). |
| `DATABASE_URL` | String de conexão do PostgreSQL. |
| `JWT_SECRET` | Segredo para assinar os tokens de sessão (troque!). |
| `NODE_ENV` | `production` em produção (cookie `secure`, exige HTTPS). |
| `POSTGRES_PORT` | Só usada pelo docker-compose de testes. |

## 9. Deploy manual (sem GitHub Actions)

```bash
cd /caminho/da/app
./deploy.sh
```

Certifique-se de que o `deploy.sh` tem permissão de execução:

```bash
chmod +x deploy.sh
```
