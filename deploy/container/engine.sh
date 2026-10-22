#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo '请使用 sudo 运行安装程序。' >&2; exit 1; }
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo '本包要求 Linux x86_64 / amd64。' >&2; exit 1; }
. /etc/os-release
case "${ID:-}:${VERSION_ID:-}:${VERSION_CODENAME:-}" in
  ubuntu:22.04:jammy|ubuntu:24.04:noble|debian:12:bookworm|debian:13:trixie) ;;
  *) echo '本版安装包适配 Ubuntu 22.04/24.04 LTS、Debian 12/13；请使用上述系统的 x86_64 服务器。' >&2; exit 1 ;;
esac
if [[ ${1:-} == --check-host ]]; then exit 0; fi
if command -v docker >/dev/null; then
  docker info >/dev/null
  docker compose version >/dev/null || { echo '请先安装 Docker Compose 插件。' >&2; exit 1; }
  exit 0
fi
case "$ID" in
  ubuntu|debian)
    # Do not remove a host's existing container runtime to force an installation.
    for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
      if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
        echo "检测到 $package，请按 Docker 官方文档处理冲突后重试；未自动卸载。" >&2; exit 1
      fi
    done
    apt-get update
    apt-get install -y ca-certificates curl
    install -d -m0755 /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    expected=$(printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$ID" "$VERSION_CODENAME" "$(dpkg --print-architecture)")
    if [[ -e /etc/apt/sources.list.d/docker.sources && $(cat /etc/apt/sources.list.d/docker.sources) != "$expected" ]]; then
      echo '已有不同的 Docker 软件源，未覆盖；请先完成 Docker 安装。' >&2; exit 1
    fi
    printf '%s\n' "$expected" > /etc/apt/sources.list.d/docker.sources
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    ;;
esac
systemctl enable --now docker
docker info >/dev/null
docker compose version
