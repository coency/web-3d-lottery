#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo '本安装包要求 Linux x86_64；ARM 需单独构建镜像。' >&2; exit 1; }
[[ $EUID == 0 ]] || { echo '请运行 sudo bash install.sh。' >&2; exit 1; }
[[ -f release.env && -f compose.yaml ]] || { echo '部署包不完整。' >&2; exit 1; }
if [[ ! -e config && -f SHA256SUMS ]]; then
  sha256sum --check --status SHA256SUMS || { echo '部署包校验失败，请重新上传完整安装包。' >&2; exit 1; }
fi
bash engine.sh --check-host
# Install only the small host utilities needed by installation and maintenance.
if ! command -v ss >/dev/null || ! command -v curl >/dev/null || ! command -v flock >/dev/null; then
  if command -v apt-get >/dev/null; then
    apt-get update
    apt-get install -y iproute2 curl ca-certificates util-linux
  else
    echo '未找到 apt-get，请使用标准 Ubuntu / Debian 服务器系统。' >&2; exit 1
  fi
fi
exec 9> .maintenance.lock
flock -n 9 || { echo '另一个安装或维护操作正在运行。' >&2; exit 1; }
# Already configured installs are resumed without rotating encryption keys or passwords.
if [[ -f config/compose.env ]]; then
  bash engine.sh
  flock -u 9
  exec bash starlit.sh start
fi
[[ ! -e config && ! -e data ]] || { echo '检测到不完整配置或数据。请先检查并恢复，安装程序不会覆盖。' >&2; exit 1; }
command -v ss >/dev/null || { echo '请先安装 iproute2。' >&2; exit 1; }
if ss -H -ltn '( sport = :80 or sport = :443 )' | grep -q .; then
  echo '80/443 已被其他服务占用。请使用独立服务器，或先规划现有网站的反向代理；不会停止已有网站。' >&2; exit 1
fi
read -r -p '网站域名（例如 lottery.company.cn，不含 https://）：' domain
domain=${domain,,}
[[ ${#domain} -le 253 && $domain =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || { echo '请输入有效的域名（中文域名请使用 Punycode）。' >&2; exit 1; }
[[ ! $domain =~ (^|\.)(localhost|example\.(com|org|net))$ ]] || { echo '请使用自己的实际域名。' >&2; exit 1; }
if ! getent ahosts "$domain" >/dev/null; then
  echo '本机暂时无法解析域名。请核对拼写，在域名实际 NS 服务商处添加 A 记录，并等待解析生效；也请检查服务器 DNS。' >&2
  exit 1
fi
echo '将安装/使用 Docker，生成独立配置并启用网站。请确保云服务器允许公网访问 TCP 80/443。'
bash engine.sh
random_hex(){ od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
stage=$(mktemp -d .config-new.XXXXXX)
trap 'echo "安装未完成。请按提示处理后重试；已存在的配置和数据均保留。" >&2' ERR
db_password=$(random_hex)
printf 'POSTGRES_USER=starlit\nPOSTGRES_DB=starlit\nPOSTGRES_PASSWORD=%s\nPGDATA=/var/lib/postgresql/18/docker\n' "$db_password" > "$stage/database.env"
printf 'NODE_ENV=production\nAPI_HOST=127.0.0.1\nAPI_PORT=3000\nTRUST_PROXY=loopback\nAPP_ORIGIN=https://%s\nDATABASE_URL=postgresql://starlit:%s@db:5432/starlit\nAUTH_SECRET=%s\nWECHAT_MASTER_KEY=%s\nASSET_DIRECTORY=/var/lib/starlit/uploads\nWECHAT_OAUTH_PROVIDER=wechat\n' "$domain" "$db_password" "$(random_hex)" "$(random_hex)" > "$stage/app.env"
printf 'APP_DOMAIN=%s\n' "$domain" > "$stage/gateway.env"
printf 'COMPOSE_PROJECT_NAME=starlit_%s\n' "$(random_hex | cut -c1-12)" > "$stage/compose.env"
unset db_password
mv -- "$stage" config
install -d -m0750 -o1000 -g1000 data/uploads
install -d -m0755 -o1000 -g1000 data/verification
# PostgreSQL's entrypoint drops to uid 999 after creating PGDATA. Its parent
# bind mount must also be traversable by that user (not root-owned mode 0700).
install -d -m0700 -o999 -g999 data/postgres
install -d -m0700 data/caddy data/caddy-config backups
flock -u 9
exec bash starlit.sh start
