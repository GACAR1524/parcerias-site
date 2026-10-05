# Gestão de Parcerias — Costa de Araújo

Sistema web para o escritório controlar os quatro braços do negócio em um só lugar:

- **Processos** — em parceria com advogados parceiros (divisão por %), com advogados
  associados (salário fixo + bonificação por processo) ou somente do escritório (valor pretendido
  da ação × nossa % de honorários finais), com honorários iniciais pagos, custo de leads,
  corretores, fase (em curso → julgado, com valor da condenação) e situação (quanto recebemos);
  na defesa do executado, os honorários finais incidem sobre a redução conseguida no débito;
- **Compra de créditos** judiciais, com possível data de recebimento e linha do tempo;
- **Contratos com empresas** (prestação de serviços com valor mensal);
- **Financeiro** mensal (receitas × despesas, lucro/prejuízo), que recebe automaticamente os
  recebimentos dos processos, as compras e recebimentos de créditos, as mensalidades dos
  contratos, os salários e bonificações dos associados; receitas parceladas ficam como
  **créditos provisionados** até a baixa.

- **Controle de horário dos colaboradores**: advogados associados e estagiários registram entrada, volta do almoço e saída
  pelo celular; a presença é comprovada por **localização (GPS)** e pela **rede do escritório (IP)**,
  e o que vier de fora fica pendente para a administração aprovar. Espelho mensal, atrasos, faltas,
  saldo de horas, ajustes e exportação.

Há um login de **controle geral** (administração, que vê tudo e a visão geral segmentada por
braço), um login para **cada advogado parceiro** (vê só os próprios processos), para **cada
associado** (processos + Meu ponto) e para **cada estagiário** (somente Meu ponto).

Este pacote está pronto para ser publicado em hospedagem própria (VPS ou serviço de
contêineres). Enquanto isso, a mesma interface roda como *artifact* no Claude — os dois
usam exatamente o mesmo código de tela; só a camada de dados muda (veja `ARQUITETURA.md`).

---

## 1. O que você precisa comprar/contratar

| Item | Recomendação | Observação |
|---|---|---|
| **Domínio** (ou subdomínio) | ex.: `parcerias.costadearaujo.adv.br` | Aponte um registro **A** para o IP do servidor. |
| **Servidor** | VPS Linux (Ubuntu 22.04/24.04), 1 vCPU, 1–2 GB RAM | Hostinger VPS, Locaweb Cloud, DigitalOcean, Contabo, etc. Custa na faixa de R$ 30–60/mês. |
| Alternativa sem VPS | Railway, Render ou Fly.io (plano com **volume persistente**) | Serviços que "adormecem" o app gratuito perdem o SQLite se não houver volume. |

Hospedagem compartilhada tradicional (cPanel só com PHP) **não serve**: o sistema roda em Node.js.

## 2. Instalação em VPS com Docker (caminho recomendado)

### 2a. Instalação automática (um comando)

Com o código em um repositório Git (GitHub privado, por exemplo) e o domínio apontando para o IP
do servidor, basta rodar, como root, no terminal do VPS (SSH ou terminal do painel da hospedagem):

```bash
curl -fsSL https://raw.githubusercontent.com/SEU_USUARIO/parcerias-site/main/deploy/install.sh \
  | bash -s -- sistema.seudominio.com.br https://SEU_TOKEN@github.com/SEU_USUARIO/parcerias-site.git
```

O `deploy/install.sh` instala o Docker, clona o código em `/opt/parcerias-site`, gera o `.env`
(segredo da sessão e domínio), sobe app + Caddy com HTTPS automático, ativa o firewall e as
atualizações de segurança do Ubuntu e agenda: **backup diário** às 3h (volume `/data/backups`) e
**atualização automática** às 4h30 (`parcerias-update`: baixa o código novo do repositório e
reconstrói só quando houver mudança — um backup é feito antes). Para atualizar na hora:
`parcerias-update`. O administrador também pode baixar uma cópia do banco a qualquer momento pelo
botão **Backup** no topo do sistema.

### 2b. Instalação manual

Tudo é feito com o terminal do servidor (SSH). Os comandos abaixo são para Ubuntu.

```bash
# 1) Instalar Docker (uma vez)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 2) Enviar esta pasta para o servidor (do seu computador)
scp -r parcerias-site usuario@SEU_IP:/opt/parcerias
#    (ou: git clone do seu repositório privado)

# 3) Configurar
cd /opt/parcerias
cp .env.example .env
nano .env         # troque JWT_SECRET (gere com: openssl rand -hex 48) e DOMAIN

# 4) Subir
docker compose up -d --build

# 5) Acompanhar (o Caddy emite o certificado HTTPS sozinho ao receber a 1ª visita)
docker compose logs -f
```

Abra `https://SEU_DOMINIO`. Na **primeira visita** o sistema pede para criar o usuário e a
senha do administrador. Depois disso essa tela não aparece mais.

> **Atualizando uma instalação anterior:** o esquema do banco é migrado sozinho ao subir
> (versão 9 — contratos, associados, estagiários, provisionados, controle de ponto). Faça `npm run backup` antes.

> **Ponto por IP:** o servidor precisa enxergar o IP real de quem acessa. Atrás do Caddy/Nginx isso já
> está resolvido com `TRUST_PROXY=1`; em outros proxies (Cloudflare, por exemplo) ajuste o valor.
> Em *Ponto → Configurar*, clique em "Adicionar meu IP atual" conectado ao Wi-Fi do escritório e em
> "Usar minha localização atual" estando lá. A geolocalização só funciona em HTTPS.

### Comandos do dia a dia

```bash
docker compose exec app npm run admin -- list             # lista usuários
docker compose exec app npm run admin -- reset admin      # redefine a senha de um usuário
docker compose exec app npm run backup                    # backup do banco em /data/backups
docker compose exec app npm run import -- /data/arquivo.csv   # importa CSV do sistema atual
docker compose pull && docker compose up -d --build       # atualizar após mudar o código
```

Para importar um CSV, copie-o antes para dentro do volume:
`docker compose cp ./parcerias-processos-2026-09-29.csv app:/data/arquivo.csv`.

### Backup automático (recomendado)

No servidor, `crontab -e` e adicione (todo dia às 3h, mantém os últimos 30):

```
0 3 * * * cd /opt/parcerias && docker compose exec -T app npm run backup >> /var/log/parcerias-backup.log 2>&1
```

Os arquivos ficam no volume `dados` (`/data/backups`). Copie-os periodicamente para fora do
servidor (Google Drive, S3, outro disco): `docker compose cp app:/data/backups ./backups-local`.

## 3. Instalação sem Docker (Node.js direto)

```bash
# Node.js 20 ou superior
cd parcerias-site
npm install --omit=dev
cp .env.example .env && nano .env      # JWT_SECRET, DB_PATH, COOKIE_SECURE=true
npm start                               # sobe na porta 3000
```

Coloque um proxy HTTPS na frente (Caddy ou Nginx + Certbot) apontando para `localhost:3000`
e use `pm2` ou um serviço `systemd` para manter o processo no ar. Exemplo de Caddyfile:

```
parcerias.seudominio.com.br {
    reverse_proxy localhost:3000
}
```

## 4. Railway / Render / Fly.io

1. Crie um serviço a partir deste repositório (eles detectam o `Dockerfile`).
2. Adicione um **volume persistente** montado em `/data`.
3. Variáveis: `JWT_SECRET`, `DB_PATH=/data/parcerias.db`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`.
4. Aponte seu domínio no painel do serviço (eles emitem o HTTPS).

## 5. Migrar os dados da versão atual (artifact do Claude)

1. No sistema atual, aba **Processos → Exportar CSV** (e, em **Compra de créditos**, o CSV de créditos, se houver).
2. Envie o arquivo ao servidor e rode `npm run import -- caminho.csv`.
3. O script cria os parceiros que ainda não existem (com login sugerido e senha temporária,
   mostrados no final) e ignora processos já cadastrados com o mesmo número.

## 6. Variáveis de ambiente

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3000` | Porta interna do Node |
| `JWT_SECRET` | — (obrigatório, ≥ 32 caracteres) | Assina os cookies de sessão |
| `DB_PATH` | `./data/parcerias.db` | Arquivo do banco SQLite |
| `SESSION_DAYS` | `30` | Duração de "manter conectado" |
| `COOKIE_SECURE` | `true` | Cookies só via HTTPS (`false` apenas em `http://localhost`) |
| `TRUST_PROXY` | `1` | Nº de proxies na frente (Caddy/Nginx); necessário para o limite de tentativas de login por IP e para a checagem de IP do ponto |
| `DOMAIN` | — | Domínio usado pelo Caddy no `docker-compose` |
| `BACKUP_DIR` | `./backups` | Pasta dos backups |

## 7. Desenvolvimento e testes

```bash
npm install
cp .env.example .env            # COOKIE_SECURE=false para http://localhost
npm run dev                     # recarrega ao salvar
npm test                        # teste da API (banco temporário)
node test/e2e.mjs               # teste no navegador contra o servidor (precisa de: npm i -D playwright)
npm run build:artifact          # gera dist/parcerias-artifact.html (versão hospedada no Claude)
node test/artifact.mjs          # testa a versão artifact no navegador, com um banco do Claude simulado
```

## 8. Estrutura de pastas

```
parcerias-site/
├── public/                # front-end (idêntico nas duas versões)
│   ├── index.html         # marcação da tela
│   ├── styles.css         # identidade visual (preto/dourado, temas claro e escuro)
│   ├── app.js             # interface: login, visão geral por braço, processos, equipe (parceiros, associados, estagiários), créditos, contratos, financeiro, controle de horário
│   ├── api-rest.js        # adaptador de dados do SITE (fala com /api)
│   ├── api-claude.js      # adaptador de dados do ARTIFACT (banco do Claude)
│   └── img/               # logo
├── server/
│   ├── index.js           # Express: segurança, estático, /api
│   ├── db.js              # SQLite, esquema, mapeamento de colunas
│   ├── auth.js            # bcrypt, JWT em cookie httpOnly, papéis
│   ├── validate.js        # validação das entradas
│   └── routes/            # auth, partners, cases, credits, finance, contracts, ponto
├── scripts/               # admin (CLI), import-csv, backup
├── deploy/                # install.sh (instalação automática no VPS) e update.sh (atualização)
├── build/                 # gera a versão artifact a partir de public/
├── test/                  # smoke (API), e2e (navegador, site) e artifact (navegador, versão Claude)
├── Dockerfile · docker-compose.yml · Caddyfile · .env.example
├── README.md              # este guia
└── ARQUITETURA.md         # decisões técnicas, modelo de dados, API, segurança
```

## 9. Segurança — resumo

- Senhas com **bcrypt** (custo 12); nunca são armazenadas nem trafegam em texto puro após o login.
- Sessão em cookie **httpOnly + SameSite=Lax + Secure**, assinado (JWT). Escritas exigem o
  cabeçalho `X-Requested-With`, o que bloqueia CSRF por formulário.
- **Limite de tentativas** de login por IP (20 a cada 15 min). Cabeçalhos de proteção via Helmet
  e CSP restrita.
- **Escopo por papel no servidor**: o parceiro só lê/grava processos do próprio `partner_id`
  (nunca processos "só do escritório"); estagiários não acessam processos; só associados e
  estagiários batem ponto; parceiros, créditos, contratos, financeiro e configuração do ponto são
  rotas exclusivas do administrador. Batidas nunca são editadas — só ajustadas com trilha.
- **Trilha de auditoria** (`audit_log`): quem fez o quê, quando e de qual IP.
- HTTPS automático (Let's Encrypt) pelo Caddy.
